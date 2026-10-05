package vn.editor.document.sharing.application.command;

import vn.editor.document.shared.domain.Values;
import vn.editor.document.sharing.domain.SharingPolicy;

public record GrantDocumentAccessCommand(
    String actor, String documentId, String granteeUserId, String role, String authorization) {
  public GrantDocumentAccessCommand {
    actor = Values.id(actor);
    documentId = Values.id(documentId);
    granteeUserId = Values.id(granteeUserId);
    role = SharingPolicy.role(role);
  }
}
