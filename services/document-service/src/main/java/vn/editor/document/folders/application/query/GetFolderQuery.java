package vn.editor.document.folders.application.query;

import vn.editor.document.shared.domain.Values;

public record GetFolderQuery(String actor, String folderId) {
  public GetFolderQuery {
    actor = Values.id(actor);
    folderId = Values.id(folderId);
  }
}
