package vn.editor.document;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.UUID;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import vn.editor.document.documents.application.port.DocumentAuthorization;
import vn.editor.document.documents.domain.Document;
import vn.editor.document.documents.domain.DocumentAccess;
import vn.editor.document.shared.domain.DomainException;
import vn.editor.document.sharing.application.command.GrantDocumentAccessByEmailCommand;
import vn.editor.document.sharing.application.command.GrantDocumentAccessCommand;
import vn.editor.document.sharing.application.command.SharingCommandHandler;
import vn.editor.document.sharing.application.port.AccountDirectory;
import vn.editor.document.sharing.application.port.SharingWriteRepository;
import vn.editor.document.sharing.application.query.PermissionView;

class SharingGrantSecurityTest {
  private final DocumentAuthorization documents = mock(DocumentAuthorization.class);
  private final SharingWriteRepository sharing = mock(SharingWriteRepository.class);
  private final AccountDirectory accounts = mock(AccountDirectory.class);
  private final SharingCommandHandler handler =
      new SharingCommandHandler(documents, sharing, accounts);
  private final String actor = UUID.randomUUID().toString();
  private final String document = UUID.randomUUID().toString();
  private final String recipient = UUID.randomUUID().toString();
  private final String email = "recipient@example.com";

  @Test
  void neitherEmailNorUserIdGrantsCanBypassRecipientVerification() {
    when(accounts.user(recipient, "Bearer token"))
        .thenReturn(new AccountDirectory.Account(recipient, email, "Recipient"));
    when(accounts.resolve(email, "Bearer token"))
        .thenThrow(new DomainException(422, "EMAIL_NOT_VERIFIED"));
    var byEmail =
        new GrantDocumentAccessByEmailCommand(actor, document, email, "VIEWER", "Bearer token");
    var byId = new GrantDocumentAccessCommand(actor, document, recipient, "EDITOR", "Bearer token");
    assertEquals(
        "EMAIL_NOT_VERIFIED",
        assertThrows(DomainException.class, () -> handler.handle(byEmail)).getMessage());
    assertEquals(
        "EMAIL_NOT_VERIFIED",
        assertThrows(DomainException.class, () -> handler.handle(byId)).getMessage());
    verifyNoInteractions(sharing);
  }

  @Test
  void verifiedEmailMustStillResolveToTheRequestedUserId() {
    when(accounts.user(recipient, "Bearer token"))
        .thenReturn(new AccountDirectory.Account(recipient, email, "Recipient"));
    when(accounts.resolve(email, "Bearer token"))
        .thenReturn(new AccountDirectory.Account(UUID.randomUUID().toString(), email, "Other"));
    var command =
        new GrantDocumentAccessCommand(actor, document, recipient, "VIEWER", "Bearer token");
    assertEquals(
        "USER_NOT_REGISTERED",
        assertThrows(DomainException.class, () -> handler.handle(command)).getMessage());
    verifyNoInteractions(sharing);
  }

  @Test
  void verifiedRecipientsStillReceiveGrantsThroughBothRoutes() {
    var account = new AccountDirectory.Account(recipient, email, "Recipient");
    when(accounts.user(recipient, "Bearer token")).thenReturn(account);
    when(accounts.resolve(email, "Bearer token")).thenReturn(account);
    when(documents.authorize(actor, document, true, false))
        .thenReturn(
            new Document(
                document,
                actor,
                null,
                null,
                "Sample",
                0,
                null,
                0,
                null,
                new DocumentAccess("OWNER", false)));
    when(sharing.<PermissionView>execute(any()))
        .thenAnswer(invocation -> invocation.<Supplier<PermissionView>>getArgument(0).get());
    var command =
        new GrantDocumentAccessCommand(actor, document, recipient, "VIEWER", "Bearer token");
    var permission = new PermissionView(recipient, "VIEWER", "2026-10-23T00:00:00Z");
    when(sharing.grant(command)).thenReturn(permission);
    assertEquals(permission, handler.handle(command));
    assertEquals(
        new PermissionView(recipient, "VIEWER", permission.updatedAt(), email, "Recipient"),
        handler.handle(
            new GrantDocumentAccessByEmailCommand(
                actor, document, email, "VIEWER", "Bearer token")));
  }
}
