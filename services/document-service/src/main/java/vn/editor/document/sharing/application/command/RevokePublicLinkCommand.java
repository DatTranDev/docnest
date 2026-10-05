package vn.editor.document.sharing.application.command;

import vn.editor.document.shared.domain.Values;

public record RevokePublicLinkCommand(String actor, String documentId, String linkId) {
  public RevokePublicLinkCommand {
    actor = Values.id(actor);
    documentId = Values.id(documentId);
    linkId = Values.id(linkId);
  }
}
