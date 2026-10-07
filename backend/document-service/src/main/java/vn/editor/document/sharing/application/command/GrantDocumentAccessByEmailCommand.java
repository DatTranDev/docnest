package vn.editor.document.sharing.application.command;

import vn.editor.document.shared.domain.DomainException;
import vn.editor.document.shared.domain.Values;
import vn.editor.document.sharing.domain.SharingPolicy;

public record GrantDocumentAccessByEmailCommand(
    String actor, String documentId, String email, String role, String authorization) {
  public GrantDocumentAccessByEmailCommand {
    actor = Values.id(actor);
    documentId = Values.id(documentId);
    if (email == null || email.length() > 254) throw new DomainException(400, "INVALID_REQUEST");
    role = SharingPolicy.role(role);
  }
}
