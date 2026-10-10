package vn.editor.document.documents.infrastructure;

import static vn.editor.document.shared.domain.Values.fields;
import static vn.editor.document.shared.domain.Values.id;
import static vn.editor.document.shared.domain.Values.integer;
import static vn.editor.document.shared.domain.Values.map;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import vn.editor.document.documents.application.port.DocumentAuthorization;
import vn.editor.document.documents.application.port.DocumentReadRepository;
import vn.editor.document.documents.application.port.DocumentWriteRepository;
import vn.editor.document.documents.application.port.SnapshotStore.ObjectReference;
import vn.editor.document.documents.application.query.DocumentView;
import vn.editor.document.documents.application.query.GetDocumentQuery;
import vn.editor.document.documents.application.query.GetVersionQuery;
import vn.editor.document.documents.application.query.ListDocumentsQuery;
import vn.editor.document.documents.application.query.ListVersionsQuery;
import vn.editor.document.documents.application.query.VersionSnapshot;
import vn.editor.document.documents.application.query.VersionView;
import vn.editor.document.documents.domain.Document;
import vn.editor.document.documents.domain.DocumentAccess;
import vn.editor.document.folders.application.port.WorkspaceDirectory;
import vn.editor.document.shared.application.Page;
import vn.editor.document.shared.domain.DomainException;
import vn.editor.document.shared.infrastructure.Cursors;
import vn.editor.document.shared.infrastructure.JdbcStore;

@Repository
public class JdbcDocumentDao extends JdbcStore
    implements DocumentAuthorization, DocumentWriteRepository, DocumentReadRepository {
  private final WorkspaceDirectory folders;
  private final int maxDocuments;
  private final Cursors cursors = new Cursors();

  public JdbcDocumentDao(
      JdbcTemplate db,
      PlatformTransactionManager manager,
      WorkspaceDirectory folders,
      @Value("${editor.quotas.documents:100}") int maximum) {
    super(db, manager);
    this.folders = folders;
    this.maxDocuments = maximum;
  }

  @Override
  public Document authorize(String actor, String documentId, boolean lock, boolean allowTrash) {
    return aggregate(documentRow(actor, documentId, lock, allowTrash));
  }

  @Override
  public void requireOwner(String actor, String documentId, boolean lock, boolean allowTrash) {
    owner(documentRow(actor, documentId, lock, allowTrash));
  }

  @Override
  public DocumentView get(GetDocumentQuery query) {
    return view(document(query.actor(), query.documentId()));
  }

  @Override
  public Page<DocumentView> list(ListDocumentsQuery query) {
    Map<String, Object> page =
        documents(
            query.actor(),
            query.scope(),
            query.parent(),
            query.titleQuery(),
            query.cursor(),
            query.limit());
    return new Page<>(
        ((List<Map<String, Object>>) page.get("items"))
            .stream().map(JdbcDocumentDao::view).toList(),
        (String) page.get("nextCursor"));
  }

  @Override
  public Page<VersionView> versions(ListVersionsQuery query) {
    Map<String, Object> page =
        versions(query.actor(), query.documentId(), query.cursor(), query.limit());
    return new Page<>(
        ((List<Map<String, Object>>) page.get("items"))
            .stream().map(JdbcDocumentDao::versionView).toList(),
        (String) page.get("nextCursor"));
  }

  @Override
  public VersionSnapshot authorizeVersionAndRecordAccess(GetVersionQuery query) {
    Map<String, Object> row =
        authorizedVersion(query.actor(), query.documentId(), query.revision());
    return new VersionSnapshot(versionView(versionDto(row)), reference(row));
  }

  public static ObjectReference reference(Map<String, Object> row) {
    return new ObjectReference(
        (String) row.get("storage_provider"),
        (String) row.get("storage_bucket"),
        (String) row.get("object_key"),
        (String) row.get("object_generation"));
  }

  public static DocumentView view(Map<String, Object> row) {
    return new DocumentView(
        (String) row.get("id"),
        (String) row.get("ownerUserId"),
        (String) row.get("folderId"),
        (String) row.get("title"),
        ((Number) row.get("headRevision")).longValue(),
        (String) row.get("headVersionId"),
        ((Number) row.get("metadataRevision")).longValue(),
        (String) row.get("effectiveRole"),
        (String) row.get("createdAt"),
        (String) row.get("updatedAt"),
        (String) row.get("deletedAt"),
        (Map<String, Object>) row.get("preview"));
  }

  public static VersionView versionView(Map<String, Object> row) {
    return new VersionView(
        (String) row.get("id"),
        (String) row.get("documentId"),
        ((Number) row.get("revision")).longValue(),
        (String) row.get("nativeSha256"),
        ((Number) row.get("nativeBytes")).longValue(),
        ((Number) row.get("textUtf8Bytes")).longValue(),
        ((Number) row.get("utf16Length")).longValue(),
        ((Number) row.get("logicalLines")).longValue(),
        (String) row.get("createdByUserId"),
        (String) row.get("createdAt"));
  }

  private Map<String, Object> cursor(String value) {
    return cursors.decode(value);
  }

  private String cursorOf(Map<String, Object> value) {
    return cursors.encode(value);
  }

  public Map<String, Object> documentRow(
      String actor, String id, boolean lock, boolean allowTrash) {
    Map<String, Object> r =
        one("SELECT * FROM documents WHERE id=?" + (lock ? " FOR UPDATE" : ""), id(id));
    if (r == null) throw new DomainException(404, "DOCUMENT_NOT_FOUND");
    String role =
        actor.equals(r.get("owner_user_id"))
            ? "OWNER"
            : db.query(
                "SELECT role FROM document_permissions WHERE document_id=? AND grantee_user_id=?",
                rs -> rs.next() ? rs.getString(1) : null,
                id,
                actor);
    new DocumentAccess(role, r.get("deleted_at") != null).requireVisible(allowTrash);
    r.put("effective_role", role);
    return r;
  }

  void owner(Map<String, Object> r) {
    new DocumentAccess(r.get("effective_role").toString(), r.get("deleted_at") != null)
        .requireOwner();
  }

  void editor(Map<String, Object> r) {
    new DocumentAccess(r.get("effective_role").toString(), r.get("deleted_at") != null)
        .requireEditor();
  }

  Map<String, Object> documentDto(Map<String, Object> r) {
    boolean owner = "OWNER".equals(r.get("effective_role"));
    return map(
        "id",
        r.get("id"),
        "ownerUserId",
        r.get("owner_user_id"),
        "folderId",
        owner ? r.get("folder_id") : null,
        "title",
        r.get("title"),
        "headRevision",
        r.get("head_revision"),
        "headVersionId",
        r.get("head_version_id"),
        "metadataRevision",
        r.get("metadata_revision"),
        "effectiveRole",
        r.get("effective_role"),
        "createdAt",
        time(r.get("created_at")),
        "updatedAt",
        time(r.get("updated_at")),
        "deletedAt",
        time(r.get("deleted_at")),
        "preview",
        r.get("preview_json") == null ? null : parse(r.get("preview_json").toString()));
  }

  private Map<String, Object> document(String actor, String id) {
    Map<String, Object> dto = documentDto(documentRow(actor, id, false, true));
    return dto;
  }

  private Map<String, Object> documents(
      String actor, String scope, String parent, String query, String cursor, int limit) {
    if (!Set.of("OWNED", "SHARED", "TRASH").contains(scope))
      throw new DomainException(400, "INVALID_REQUEST");
    limit = (int) integer(limit, 1, 100);
    String p = scope.equals("OWNED") ? folders.resolveParent(actor, parent) : null;
    Map<String, Object> c = cursor(cursor);
    List<Object> a = new ArrayList<>();
    String sql =
        scope.equals("SHARED")
            ? "SELECT d.*,p.role AS effective_role FROM documents d JOIN document_permissions p ON"
                + " p.document_id=d.id WHERE p.grantee_user_id=? AND d.deleted_at IS NULL"
            : "SELECT d.*,'OWNER' AS effective_role FROM documents d WHERE d.owner_user_id=? AND"
                + " d.deleted_at IS "
                + (scope.equals("TRASH") ? "NOT NULL" : "NULL AND d.folder_id <=> ?");
    a.add(actor);
    if (scope.equals("OWNED")) a.add(p);
    if (query != null) {
      if (query.codePointCount(0, query.length()) > 200)
        throw new DomainException(400, "INVALID_REQUEST");
      sql += " AND LOCATE(?,d.title)>0";
      a.add(query);
    }
    if (c != null) {
      fields(c, "at,id", "");
      id(c.get("id"));
      Timestamp at;
      try {
        at = Timestamp.from(Instant.parse(c.get("at").toString()));
      } catch (Exception ex) {
        throw new DomainException(400, "INVALID_CURSOR");
      }
      sql += " AND (d.created_at>? OR (d.created_at=? AND d.id>?))";
      a.addAll(Arrays.asList(at, at, c.get("id")));
    }
    a.add(limit + 1);
    List<Map<String, Object>> rows =
        db.queryForList(sql + " ORDER BY d.created_at,d.id LIMIT ?", a.toArray());
    boolean more = rows.size() > limit;
    if (more) rows.removeLast();
    return map(
        "items",
        rows.stream().map(this::documentDto).toList(),
        "nextCursor",
        more
            ? cursorOf(
                map("at", time(rows.getLast().get("created_at")), "id", rows.getLast().get("id")))
            : null);
  }

  public Map<String, Object> versionDto(Map<String, Object> r) {
    return map(
        "id",
        r.get("id"),
        "documentId",
        r.get("document_id"),
        "revision",
        r.get("revision"),
        "nativeSha256",
        r.get("native_sha256"),
        "nativeBytes",
        r.get("native_bytes"),
        "textUtf8Bytes",
        r.get("text_utf8_bytes"),
        "utf16Length",
        r.get("utf16_length"),
        "logicalLines",
        r.get("logical_lines"),
        "createdByUserId",
        r.get("created_by_user_id"),
        "createdAt",
        time(r.get("created_at")));
  }

  private Map<String, Object> versions(String actor, String id, String cursor, int limit) {
    documentRow(actor, id, false, false);
    limit = (int) integer(limit, 1, 100);
    Map<String, Object> c = cursor(cursor);
    long before = c == null ? Long.MAX_VALUE : integer(c.get("revision"), 1, 9007199254740991L);
    List<Map<String, Object>> rows =
        db.queryForList(
            "SELECT * FROM document_versions WHERE document_id=? AND retired_at IS NULL AND"
                + " revision<? ORDER BY revision DESC LIMIT ?",
            id,
            before,
            limit + 1);
    boolean more = rows.size() > limit;
    if (more) rows.removeLast();
    return map(
        "items",
        rows.stream().map(this::versionDto).toList(),
        "nextCursor",
        more ? cursorOf(map("revision", rows.getLast().get("revision"))) : null);
  }

  Map<String, Object> authorizedVersion(String actor, String id, long rev) {
    return transaction(
        () -> {
          documentRow(actor, id, true, false);
          Map<String, Object> r =
              one(
                  "SELECT * FROM document_versions WHERE document_id=? AND revision=? FOR UPDATE",
                  id,
                  integer(rev, 1, 9007199254740991L));
          if (r == null || r.get("retired_at") != null)
            throw new DomainException(410, "VERSION_GONE");
          db.update("UPDATE document_versions SET last_access_at=? WHERE id=?", now(), r.get("id"));
          return r;
        });
  }

  @Override
  public <T> T execute(Supplier<T> action) {
    return transaction(action);
  }

  @Override
  public Document load(String actor, String id, boolean allowTrash) {
    return aggregate(documentRow(actor, id, true, allowTrash));
  }

  @Override
  public long count(String actor) {
    return db.queryForObject(
        "SELECT COUNT(*) FROM documents WHERE owner_user_id=?", Long.class, actor);
  }

  @Override
  public int maximum() {
    return maxDocuments;
  }

  @Override
  public void insert(String actor, String id, String title, String folder) {
    Timestamp time = now();
    db.update(
        "INSERT INTO documents(id,owner_user_id,folder_id,title,created_at,updated_at) VALUES"
            + " (?,?,?,?,?,?)",
        id,
        actor,
        folder,
        title,
        time,
        time);
  }

  @Override
  public void updateMetadata(Document document) {
    db.update(
        "UPDATE documents SET title=?,folder_id=?,metadata_revision=?,updated_at=? WHERE id=?",
        document.title(),
        document.folderId(),
        document.metadataRevision(),
        now(),
        document.id());
  }

  @Override
  public void markTrash(String id) {
    Timestamp time = now();
    db.update(
        "UPDATE documents SET"
            + " restore_folder_id=folder_id,folder_id=NULL,deleted_at=?,metadata_revision=metadata_revision+1,updated_at=?"
            + " WHERE id=?",
        time,
        time,
        id);
  }

  @Override
  public void restore(String id, String folder) {
    db.update(
        "UPDATE documents SET"
            + " folder_id=?,restore_folder_id=NULL,deleted_at=NULL,metadata_revision=metadata_revision+1,updated_at=?"
            + " WHERE id=?",
        folder,
        now(),
        id);
  }

  @Override
  public DocumentView view(String actor, String id) {
    return view(document(actor, id));
  }

  private static Document aggregate(Map<String, Object> row) {
    return new Document(
        row.get("id").toString(),
        row.get("owner_user_id").toString(),
        (String) row.get("folder_id"),
        (String) row.get("restore_folder_id"),
        row.get("title").toString(),
        ((Number) row.get("head_revision")).longValue(),
        (String) row.get("head_version_id"),
        ((Number) row.get("metadata_revision")).longValue(),
        row.get("deleted_at") == null ? null : timestamp(row.get("deleted_at")).toInstant(),
        new DocumentAccess(row.get("effective_role").toString(), row.get("deleted_at") != null));
  }
}
