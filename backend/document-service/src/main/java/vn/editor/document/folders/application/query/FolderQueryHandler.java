package vn.editor.document.folders.application.query;

import vn.editor.document.folders.application.port.FolderReadRepository;
import vn.editor.document.shared.application.Page;

public final class FolderQueryHandler implements FolderQueryService {
  private final FolderReadRepository folders;

  public FolderQueryHandler(FolderReadRepository folders) {
    this.folders = folders;
  }

  public FolderView handle(GetFolderQuery query) {
    return folders.get(query);
  }

  public Page<FolderView> handle(ListFoldersQuery query) {
    return folders.list(query);
  }
}
