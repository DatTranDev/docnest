package vn.editor.document.folders.application.port;

/** Cross-feature capability: callers participate in the same short workspace transaction. */
public interface WorkspaceDirectory {
  void lockWorkspace(String owner);

  void requireFolder(String owner, String folder);

  String resolveParent(String owner, String parent);

  boolean folderExists(String owner, String folder);
}
