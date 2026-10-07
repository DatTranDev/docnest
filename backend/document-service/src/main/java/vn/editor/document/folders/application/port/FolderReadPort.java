package vn.editor.document.folders.application.port;

import vn.editor.document.folders.application.query.FolderView;
import vn.editor.document.folders.application.query.GetFolderQuery;
import vn.editor.document.folders.application.query.ListFoldersQuery;
import vn.editor.document.shared.application.Page;

public interface FolderReadPort {
  FolderView get(GetFolderQuery query);

  Page<FolderView> list(ListFoldersQuery query);
}
