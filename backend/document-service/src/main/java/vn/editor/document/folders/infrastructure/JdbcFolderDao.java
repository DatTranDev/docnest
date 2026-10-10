package vn.editor.document.folders.infrastructure;

import static vn.editor.document.shared.domain.Values.fields;
import static vn.editor.document.shared.domain.Values.id;
import static vn.editor.document.shared.domain.Values.integer;
import static vn.editor.document.shared.domain.Values.map;
import static vn.editor.document.shared.domain.Values.name;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import vn.editor.document.folders.application.port.FolderReadRepository;
import vn.editor.document.folders.application.port.FolderWriteRepository;
import vn.editor.document.folders.application.port.WorkspaceDirectory;
import vn.editor.document.folders.application.query.FolderView;
import vn.editor.document.folders.application.query.GetFolderQuery;
import vn.editor.document.folders.application.query.ListFoldersQuery;
import vn.editor.document.folders.domain.Folder;
import vn.editor.document.shared.application.Page;
import vn.editor.document.shared.domain.DomainException;
import vn.editor.document.shared.infrastructure.Cursors;
import vn.editor.document.shared.infrastructure.JdbcStore;

@Repository
public class JdbcFolderDao extends JdbcStore
    implements FolderWriteRepository, FolderReadRepository, WorkspaceDirectory {
  private final int maxFolders;
  private final Cursors cursors = new Cursors();

  public JdbcFolderDao(
      JdbcTemplate db,
      PlatformTransactionManager manager,
      @Value("${editor.quotas.folders:100}") int maxFolders) {
    super(db, manager);
    this.maxFolders = maxFolders;
  }

  @Override
  public FolderView get(GetFolderQuery query) {
    return view(getFolder(query.actor(), query.folderId()));
  }

  @Override
  public Page<FolderView> list(ListFoldersQuery query) {
    Map<String, Object> page =
        folders(query.actor(), query.parent(), query.cursor(), query.limit());
    return new Page<>(
        ((List<Map<String, Object>>) page.get("items")).stream().map(JdbcFolderDao::view).toList(),
        (String) page.get("nextCursor"));
  }

  @Override
  public void lockWorkspace(String owner) {
    workspace(owner);
  }

  @Override
  public void requireFolder(String owner, String folder) {
    checkParent(owner, folder);
  }

  @Override
  public String resolveParent(String owner, String parent) {
    return parent(owner, parent);
  }

  @Override
  public boolean folderExists(String owner, String folder) {
    return one("SELECT id FROM folders WHERE id=? AND owner_user_id=?", folder, owner) != null;
  }

  @Override
  public List<String> ancestors(String actor, String parent) {
    List<String> ids = new ArrayList<>();
    while (parent != null) {
      if (ids.contains(parent)) throw new DomainException(409, "FOLDER_CYCLE");
      ids.add(parent);
      parent = (String) folderRow(actor, parent, false).get("parent_id");
    }
    return ids;
  }

  private static FolderView view(Map<String, Object> row) {
    return new FolderView(
        (String) row.get("id"),
        (String) row.get("parentId"),
        (String) row.get("name"),
        ((Number) row.get("metadataRevision")).longValue(),
        (String) row.get("createdAt"),
        (String) row.get("updatedAt"));
  }

  private Map<String, Object> cursor(String value) {
    return cursors.decode(value);
  }

  private String cursorOf(Map<String, Object> value) {
    return cursors.encode(value);
  }

  void workspace(String actor) {
    db.update(
        "INSERT INTO owner_workspaces(owner_user_id,created_at) VALUES (?,?) ON DUPLICATE KEY"
            + " UPDATE tree_revision=tree_revision",
        actor,
        now());
    db.queryForObject(
        "SELECT tree_revision FROM owner_workspaces WHERE owner_user_id=? FOR UPDATE",
        Long.class,
        actor);
  }

  Map<String, Object> folderRow(String actor, String folder, boolean lock) {
    Map<String, Object> row =
        one(
            "SELECT * FROM folders WHERE id=? AND owner_user_id=?" + (lock ? " FOR UPDATE" : ""),
            id(folder),
            actor);
    if (row == null) throw new DomainException(404, "FOLDER_NOT_FOUND");
    return row;
  }

  Map<String, Object> folderDto(Map<String, Object> r) {
    return map(
        "id",
        r.get("id"),
        "parentId",
        r.get("parent_id"),
        "name",
        r.get("name"),
        "metadataRevision",
        r.get("metadata_revision"),
        "createdAt",
        time(r.get("created_at")),
        "updatedAt",
        time(r.get("updated_at")));
  }

  void checkParent(String actor, String parent) {
    if (parent != null) folderRow(actor, parent, false);
  }

  public int depth(String actor, String folder) {
    int depth = 0;
    Set<String> seen = new HashSet<>();
    while (folder != null) {
      if (!seen.add(folder)) throw new DomainException(409, "FOLDER_CYCLE");
      folder = (String) folderRow(actor, folder, false).get("parent_id");
      depth++;
    }
    return depth;
  }

  @Override
  public int subtreeHeight(String actor, String root) {
    int height = 1;
    for (Map<String, Object> child :
        db.queryForList(
            "SELECT id FROM folders WHERE owner_user_id=? AND parent_id=?", actor, root))
      height = Math.max(height, 1 + subtreeHeight(actor, (String) child.get("id")));
    return height;
  }

  private Map<String, Object> getFolder(String actor, String id) {
    return folderDto(folderRow(actor, id, false));
  }

  String parent(String actor, String parent) {
    if (parent.equals("root")) return null;
    checkParent(actor, id(parent));
    return parent;
  }

  private Map<String, Object> folders(String actor, String parent, String cursor, int limit) {
    String p = parent(actor, parent);
    limit = (int) integer(limit, 1, 100);
    Map<String, Object> c = cursor(cursor);
    List<Object> a = new ArrayList<>(Arrays.asList(actor, p));
    String sql = "SELECT * FROM folders WHERE owner_user_id=? AND parent_id <=> ?";
    if (c != null) {
      fields(c, "name,id", "");
      id(c.get("id"));
      String n = name(c.get("name"), 120);
      sql += " AND (name_norm>? OR (name_norm=? AND id>?))";
      a.addAll(Arrays.asList(n, n, c.get("id")));
    }
    a.add(limit + 1);
    List<Map<String, Object>> rows =
        db.queryForList(sql + " ORDER BY name_norm,id LIMIT ?", a.toArray());
    boolean more = rows.size() > limit;
    if (more) rows.removeLast();
    List<Map<String, Object>> items = rows.stream().map(this::folderDto).toList();
    return map(
        "items",
        items,
        "nextCursor",
        more
            ? cursorOf(map("name", rows.getLast().get("name_norm"), "id", rows.getLast().get("id")))
            : null);
  }

  @Override
  public <T> T execute(Supplier<T> action) {
    return transaction(action);
  }

  @Override
  public Folder load(String actor, String id, boolean lock) {
    Map<String, Object> row = folderRow(actor, id, lock);
    return new Folder(
        id,
        actor,
        (String) row.get("parent_id"),
        (String) row.get("name"),
        ((Number) row.get("metadata_revision")).longValue());
  }

  @Override
  public long count(String actor) {
    return db.queryForObject(
        "SELECT COUNT(*) FROM folders WHERE owner_user_id=?", Long.class, actor);
  }

  @Override
  public int maximum() {
    return maxFolders;
  }

  @Override
  public long children(String id) {
    return db.queryForObject(
        "SELECT (SELECT COUNT(*) FROM folders WHERE parent_id=?)+(SELECT COUNT(*) FROM documents"
            + " WHERE folder_id=? AND deleted_at IS NULL)",
        Long.class,
        id,
        id);
  }

  @Override
  public void insert(Folder folder) {
    Timestamp time = now();
    try {
      db.update(
          "INSERT INTO folders(id,owner_user_id,parent_id,name,name_norm,created_at,updated_at)"
              + " VALUES (?,?,?,?,?,?,?)",
          folder.id(),
          folder.owner(),
          folder.parentId(),
          folder.name(),
          folder.name(),
          time,
          time);
    } catch (DuplicateKeyException ex) {
      throw new DomainException(409, "FOLDER_NAME_EXISTS");
    }
  }

  @Override
  public void update(Folder folder) {
    try {
      db.update(
          "UPDATE folders SET name=?,name_norm=?,parent_id=?,metadata_revision=?,updated_at=? WHERE"
              + " id=?",
          folder.name(),
          folder.name(),
          folder.parentId(),
          folder.metadataRevision(),
          now(),
          folder.id());
    } catch (DuplicateKeyException ex) {
      throw new DomainException(409, "FOLDER_NAME_EXISTS");
    }
  }

  @Override
  public void delete(String id) {
    db.update("DELETE FROM folders WHERE id=?", id);
  }

  @Override
  public void changed(String owner) {
    db.update(
        "UPDATE owner_workspaces SET tree_revision=tree_revision+1 WHERE owner_user_id=?", owner);
  }

  @Override
  public FolderView view(String actor, String id) {
    return view(getFolder(actor, id));
  }
}
