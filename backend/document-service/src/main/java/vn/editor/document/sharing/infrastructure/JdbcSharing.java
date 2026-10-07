package vn.editor.document.sharing.infrastructure;

import static vn.editor.document.shared.domain.Values.id;
import static vn.editor.document.shared.domain.Values.integer;
import static vn.editor.document.shared.domain.Values.map;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import vn.editor.common.codec.NativeCodec;
import vn.editor.document.documents.application.port.DocumentAuthorization;
import vn.editor.document.documents.application.port.SnapshotStore.ObjectReference;
import vn.editor.document.shared.application.Page;
import vn.editor.document.shared.domain.DomainException;
import vn.editor.document.shared.infrastructure.Cursors;
import vn.editor.document.shared.infrastructure.JdbcStore;
import vn.editor.document.sharing.application.command.CreatePublicLinkCommand;
import vn.editor.document.sharing.application.command.CreatedLink;
import vn.editor.document.sharing.application.command.GrantDocumentAccessCommand;
import vn.editor.document.sharing.application.command.RevokeDocumentAccessCommand;
import vn.editor.document.sharing.application.command.RevokePublicLinkCommand;
import vn.editor.document.sharing.application.port.SharingReadPort;
import vn.editor.document.sharing.application.port.SharingWritePort;
import vn.editor.document.sharing.application.query.LinkView;
import vn.editor.document.sharing.application.query.ListPermissionsQuery;
import vn.editor.document.sharing.application.query.ListPublicLinksQuery;
import vn.editor.document.sharing.application.query.PermissionView;
import vn.editor.document.sharing.application.query.PublicDocumentView;
import vn.editor.document.sharing.domain.SharingPolicy;

@Repository
public class JdbcSharing extends JdbcStore implements SharingWritePort, SharingReadPort {
  private final DocumentAuthorization authorization;
  private final SecureRandom random = new SecureRandom();
  private final Cursors cursors = new Cursors();

  public JdbcSharing(
      JdbcTemplate db, PlatformTransactionManager manager, DocumentAuthorization authorization) {
    super(db, manager);
    this.authorization = authorization;
  }

  @Override
  public Page<PermissionView> permissions(ListPermissionsQuery query) {
    Map<String, Object> page =
        permissions(query.actor(), query.documentId(), query.cursor(), query.limit());
    return new Page<>(
        ((List<Map<String, Object>>) page.get("items"))
            .stream().map(JdbcSharing::permission).toList(),
        (String) page.get("nextCursor"));
  }

  @Override
  public Page<LinkView> links(ListPublicLinksQuery query) {
    Map<String, Object> page =
        links(query.actor(), query.documentId(), query.cursor(), query.limit());
    return new Page<>(
        ((List<Map<String, Object>>) page.get("items")).stream().map(JdbcSharing::link).toList(),
        (String) page.get("nextCursor"));
  }

  @Override
  public PublicDocumentView publicDocument(String token) {
    Map<String, Object> row = publicDocumentMap(token);
    return new PublicDocumentView(
        (String) row.get("documentId"),
        (String) row.get("title"),
        ((Number) row.get("headRevision")).longValue(),
        (Boolean) row.get("empty"),
        (String) row.get("contentPath"));
  }

  @Override
  public ObjectReference authorizePublicContentAndRecordAccess(String token) {
    Map<String, Object> r =
        transaction(
            () -> {
              Map<String, Object> d = publicRow(token);
              Map<String, Object> v =
                  one(
                      "SELECT * FROM document_versions WHERE id=? FOR UPDATE",
                      d.get("head_version_id"));
              if (v == null) throw new DomainException(404, "DOCUMENT_NOT_FOUND");
              db.update(
                  "UPDATE document_versions SET last_access_at=? WHERE id=?", now(), v.get("id"));
              return v;
            });
    return new ObjectReference(
        (String) r.get("storage_provider"),
        (String) r.get("storage_bucket"),
        (String) r.get("object_key"),
        (String) r.get("object_generation"));
  }

  private static PermissionView permission(Map<String, Object> row) {
    return new PermissionView(
        (String) row.get("granteeUserId"), (String) row.get("role"), (String) row.get("updatedAt"));
  }

  private static LinkView link(Map<String, Object> row) {
    return new LinkView(
        (String) row.get("id"),
        (String) row.get("createdAt"),
        (String) row.get("expiresAt"),
        (String) row.get("revokedAt"));
  }

  private Map<String, Object> cursor(String value) {
    return cursors.decode(value);
  }

  private String cursorOf(Map<String, Object> value) {
    return cursors.encode(value);
  }

  private Map<String, Object> permissions(String actor, String document, String cursor, int limit) {
    authorization.requireOwner(actor, document, false, true);
    limit = (int) integer(limit, 1, 100);
    Map<String, Object> c = cursor(cursor);
    String before = c == null ? "" : id(c.get("id"));
    List<Map<String, Object>> r =
        db.queryForList(
            "SELECT * FROM document_permissions WHERE document_id=? AND grantee_user_id>? ORDER BY"
                + " grantee_user_id LIMIT ?",
            document,
            before,
            limit + 1);
    boolean more = r.size() > limit;
    if (more) r.removeLast();
    return map(
        "items",
        r.stream()
            .map(
                x ->
                    map(
                        "granteeUserId",
                        x.get("grantee_user_id"),
                        "role",
                        x.get("role"),
                        "updatedAt",
                        time(x.get("updated_at"))))
            .toList(),
        "nextCursor",
        more ? cursorOf(map("id", r.getLast().get("grantee_user_id"))) : null);
  }

  Map<String, Object> linkDto(Map<String, Object> r) {
    return map(
        "id",
        r.get("id"),
        "createdAt",
        time(r.get("created_at")),
        "expiresAt",
        time(r.get("expires_at")),
        "revokedAt",
        time(r.get("revoked_at")));
  }

  private Map<String, Object> links(String actor, String document, String cursor, int limit) {
    authorization.requireOwner(actor, document, false, true);
    limit = (int) integer(limit, 1, 100);
    Map<String, Object> c = cursor(cursor);
    String before = c == null ? "" : id(c.get("id"));
    List<Map<String, Object>> r =
        db.queryForList(
            "SELECT * FROM share_links WHERE document_id=? AND id>? ORDER BY id LIMIT ?",
            document,
            before,
            limit + 1);
    boolean more = r.size() > limit;
    if (more) r.removeLast();
    return map(
        "items",
        r.stream().map(this::linkDto).toList(),
        "nextCursor",
        more ? cursorOf(map("id", r.getLast().get("id"))) : null);
  }

  Map<String, Object> publicRow(String token) {
    SharingPolicy.publicToken(token);
    Map<String, Object> r =
        one(
            "SELECT d.* FROM share_links l JOIN documents d ON d.id=l.document_id WHERE"
                + " l.token_sha256=? AND l.expires_at>? AND l.revoked_at IS NULL AND d.deleted_at"
                + " IS NULL",
            NativeCodec.sha256(token.getBytes(StandardCharsets.US_ASCII)),
            now());
    if (r == null) throw new DomainException(404, "DOCUMENT_NOT_FOUND");
    return r;
  }

  private Map<String, Object> publicDocumentMap(String token) {
    Map<String, Object> d = publicRow(token);
    boolean empty = ((Number) d.get("head_revision")).longValue() == 0;
    return map(
        "documentId",
        d.get("id"),
        "title",
        d.get("title"),
        "headRevision",
        d.get("head_revision"),
        "empty",
        empty,
        "contentPath",
        empty ? null : "/api/v1/public/shares/" + token + "/content");
  }

  @Override
  public <T> T execute(Supplier<T> action) {
    return transaction(action);
  }

  @Override
  public LinkSecret newLinkSecret() {
    byte[] bytes = new byte[32];
    random.nextBytes(bytes);
    String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    return new LinkSecret(token, NativeCodec.sha256(token.getBytes(StandardCharsets.US_ASCII)));
  }

  @Override
  public PermissionView grant(GrantDocumentAccessCommand command) {
    Timestamp time = now();
    db.update(
        "INSERT INTO"
            + " document_permissions(document_id,grantee_user_id,role,granted_by_user_id,created_at,updated_at)"
            + " VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE role=?,updated_at=?",
        command.documentId(),
        command.granteeUserId(),
        command.role(),
        command.actor(),
        time,
        time,
        command.role(),
        time);
    return new PermissionView(command.granteeUserId(), command.role(), time.toInstant().toString());
  }

  @Override
  public void revoke(RevokeDocumentAccessCommand command) {
    db.update(
        "DELETE FROM document_permissions WHERE document_id=? AND grantee_user_id=?",
        command.documentId(),
        command.granteeUserId());
  }

  @Override
  public CreatedLink createLink(CreatePublicLinkCommand command, LinkSecret secret) {
    String id = uuid();
    Timestamp time = now();
    db.update(
        "INSERT INTO"
            + " share_links(id,document_id,token_sha256,created_by_user_id,created_at,expires_at)"
            + " VALUES (?,?,?,?,?,?)",
        id,
        command.documentId(),
        secret.hash(),
        command.actor(),
        time,
        Timestamp.from(Instant.now().plusSeconds(command.expiresInSeconds())));
    return new CreatedLink(
        link(linkDto(one("SELECT * FROM share_links WHERE id=?", id))),
        secret.token(),
        "/s/" + secret.token());
  }

  @Override
  public void revokeLink(RevokePublicLinkCommand command) {
    db.update(
        "UPDATE share_links SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND document_id=?",
        now(),
        command.linkId(),
        command.documentId());
  }
}
