package vn.editor.document.sharing.application.command;

import vn.editor.document.documents.application.port.DocumentAuthorization;
import vn.editor.document.documents.domain.Document;
import vn.editor.document.sharing.application.port.AccountDirectory;
import vn.editor.document.sharing.application.port.SharingWritePort;
import vn.editor.document.sharing.application.query.PermissionView;
import vn.editor.document.sharing.domain.SharingPolicy;

public final class SharingCommandHandler {
  private final DocumentAuthorization documents;
  private final SharingWritePort sharing;
  private final AccountDirectory accounts;

  public SharingCommandHandler(
      DocumentAuthorization documents, SharingWritePort sharing, AccountDirectory accounts) {
    this.documents = documents;
    this.sharing = sharing;
    this.accounts = accounts;
  }

  public PermissionView handle(GrantDocumentAccessByEmailCommand command) {
    documents.requireOwner(command.actor(), command.documentId(), false, false);
    AccountDirectory.Account account = accounts.resolve(command.email(), command.authorization());
    PermissionView permission =
        grant(
            new GrantDocumentAccessCommand(
                command.actor(),
                command.documentId(),
                account.id(),
                command.role(),
                command.authorization()));
    return new PermissionView(
        permission.granteeUserId(),
        permission.role(),
        permission.updatedAt(),
        account.email(),
        account.displayName());
  }

  public PermissionView handle(GrantDocumentAccessCommand command) {
    documents.requireOwner(command.actor(), command.documentId(), false, false);
    accounts.user(command.granteeUserId(), command.authorization());
    return grant(command);
  }

  private PermissionView grant(GrantDocumentAccessCommand command) {
    return sharing.execute(
        () -> {
          Document document =
              documents.authorize(command.actor(), command.documentId(), true, false);
          document.access().requireOwner();
          SharingPolicy.grantee(command.actor(), document.ownerUserId(), command.granteeUserId());
          return sharing.grant(command);
        });
  }

  public void handle(RevokeDocumentAccessCommand command) {
    sharing.execute(
        () -> {
          documents.requireOwner(command.actor(), command.documentId(), true, true);
          sharing.revoke(command);
          return null;
        });
  }

  public CreatedLink handle(CreatePublicLinkCommand command) {
    SharingWritePort.LinkSecret secret = sharing.newLinkSecret();
    return sharing.execute(
        () -> {
          documents.requireOwner(command.actor(), command.documentId(), true, false);
          return sharing.createLink(command, secret);
        });
  }

  public void handle(RevokePublicLinkCommand command) {
    sharing.execute(
        () -> {
          documents.requireOwner(command.actor(), command.documentId(), true, true);
          sharing.revokeLink(command);
          return null;
        });
  }
}
