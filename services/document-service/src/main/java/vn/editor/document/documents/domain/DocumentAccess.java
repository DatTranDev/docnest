package vn.editor.document.documents.domain;

import vn.editor.document.shared.domain.DomainException;

public record DocumentAccess(String role, boolean deleted) {
  public DocumentAccess {
    if (role == null) throw new DomainException(404, "DOCUMENT_NOT_FOUND");
  }

  public void requireVisible(boolean allowTrash) {
    if (deleted && (!allowTrash || !role.equals("OWNER")))
      throw new DomainException(404, "DOCUMENT_NOT_FOUND");
  }

  public void requireOwner() {
    if (!role.equals("OWNER")) throw new DomainException(403, "OWNER_REQUIRED");
  }

  public void requireEditor() {
    if (role.equals("VIEWER")) throw new DomainException(403, "READ_ONLY");
  }

  public boolean owner() {
    return role.equals("OWNER");
  }
}
