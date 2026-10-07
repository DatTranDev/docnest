package vn.editor.document.sharing.application.command;

import vn.editor.document.shared.domain.Values;

public record RevokeDocumentAccessCommand(String actor, String documentId, String granteeUserId) {
  public RevokeDocumentAccessCommand {
    actor = Values.id(actor);
    documentId = Values.id(documentId);
    granteeUserId = Values.id(granteeUserId);
  }
}
