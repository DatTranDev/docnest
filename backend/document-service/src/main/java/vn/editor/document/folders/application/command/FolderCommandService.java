package vn.editor.document.folders.application.command;

import vn.editor.document.folders.application.query.FolderView;

public interface FolderCommandService {
  FolderView handle(CreateFolderCommand command);

  FolderView handle(MoveFolderCommand command);

  void handle(DeleteFolderCommand command);
}
