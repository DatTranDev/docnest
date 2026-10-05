package vn.editor.document.folders.application.port;

import java.util.List;
import java.util.function.Supplier;
import vn.editor.document.folders.application.query.FolderView;
import vn.editor.document.folders.domain.Folder;

/** A workspace unit of work: the callback contains only bounded SQL and plain domain operations. */
public interface FolderWritePort extends WorkspaceDirectory {
  <T> T execute(Supplier<T> action);

  Folder load(String actor, String folderId, boolean lock);

  List<String> ancestors(String actor, String parent);

  int subtreeHeight(String actor, String folderId);

  long count(String actor);

  int maximum();

  long children(String folderId);

  void insert(Folder folder);

  void update(Folder folder);

  void delete(String folderId);

  void changed(String owner);

  FolderView view(String actor, String folderId);
}
