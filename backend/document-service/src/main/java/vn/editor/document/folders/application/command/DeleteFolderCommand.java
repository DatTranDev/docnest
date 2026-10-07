package vn.editor.document.folders.application.command;

import vn.editor.document.shared.domain.Values;

public record DeleteFolderCommand(String actor, String folderId, long expectedMetadataRevision) {
  public DeleteFolderCommand {
    actor = Values.id(actor);
    folderId = Values.id(folderId);
    Values.integer(expectedMetadataRevision, 1, Values.MAX_SAFE_INTEGER);
  }
}
