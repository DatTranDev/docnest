package vn.editor.document.folders.application.query;

import vn.editor.document.shared.application.Page;

public interface FolderQueryService {
  FolderView handle(GetFolderQuery query);

  Page<FolderView> handle(ListFoldersQuery query);
}
