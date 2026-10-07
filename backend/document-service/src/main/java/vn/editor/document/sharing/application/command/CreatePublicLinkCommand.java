package vn.editor.document.sharing.application.command;

import vn.editor.document.shared.domain.Values;
import vn.editor.document.sharing.domain.SharingPolicy;

public record CreatePublicLinkCommand(String actor, String documentId, long expiresInSeconds) {
  public CreatePublicLinkCommand {
    actor = Values.id(actor);
    documentId = Values.id(documentId);
    expiresInSeconds = SharingPolicy.lifetime(expiresInSeconds);
  }
}
