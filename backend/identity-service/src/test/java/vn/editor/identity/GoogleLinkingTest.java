package vn.editor.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import vn.editor.identity.auth.application.command.AuthenticationSession;
import vn.editor.identity.auth.application.command.GoogleLoginHandler;
import vn.editor.identity.auth.application.command.LinkGoogleHandler;
import vn.editor.identity.auth.application.command.SessionIssuer;
import vn.editor.identity.auth.application.port.AccountCommandRepository;
import vn.editor.identity.auth.application.port.GoogleIdentity;
import vn.editor.identity.auth.application.port.GoogleIdentityVerifier;
import vn.editor.identity.auth.application.port.PasswordHashes;
import vn.editor.identity.auth.application.port.Transactions;
import vn.editor.identity.auth.application.query.UserView;
import vn.editor.identity.auth.domain.Account;
import vn.editor.identity.auth.domain.AccountEmail;
import vn.editor.identity.auth.domain.AuthenticationFailure;

class GoogleLinkingTest {
  private static final Clock CLOCK =
      Clock.fixed(Instant.parse("2026-10-19T00:00:00Z"), ZoneOffset.UTC);
  private final AccountCommandRepository accounts = mock(AccountCommandRepository.class);
  private final PasswordHashes passwords = mock(PasswordHashes.class);
  private final SessionIssuer issuer = mock(SessionIssuer.class);
  private final AccountEmail email = new AccountEmail("alice@example.com");
  private final GoogleIdentity identity = new GoogleIdentity("google-sub", email, "Alice", null);
  private final GoogleIdentityVerifier verifier = credential -> identity;
  private final Transactions transactions =
      new Transactions() {
        @Override
        public <T> T execute(Supplier<T> operation) {
          return operation.get();
        }
      };
  private final Account account =
      new Account("user-1", email, "hash", "Alice", true, CLOCK.instant());

  @Test
  void emailCollisionRequiresExplicitLinkAndCreatesNoIdentity() {
    when(accounts.emailExists(email)).thenReturn(true);
    var handler = new GoogleLoginHandler(accounts, transactions, issuer, verifier, CLOCK, 100);
    var failure = assertThrows(AuthenticationFailure.class, () -> handler.handle("google-token"));
    assertEquals(AuthenticationFailure.Reason.GOOGLE_LINK_REQUIRED, failure.reason());
    verify(accounts, never()).insert(any());
    verify(accounts, never()).linkGoogleSubject(any(), any(), any());
  }

  @Test
  void passwordVerifiedLinkKeepsExistingInternalUserId() {
    when(accounts.findByEmail(email)).thenReturn(account);
    when(accounts.lockById(account.id())).thenReturn(account);
    when(passwords.matches("correct-password", "hash")).thenReturn(true);
    when(issuer.issue(eq(account), any(), any())).thenReturn(session());
    var handler = new LinkGoogleHandler(accounts, passwords, verifier, transactions, issuer, CLOCK);
    var result = handler.handle(email.value(), "correct-password", "google-token");
    assertEquals(account.id(), result.user().id());
    verify(accounts).linkGoogleSubject(identity.subject(), account.id(), email);
    verify(accounts, never()).insert(any());
  }

  @Test
  void returningGoogleSubjectSignsIntoSameAccount() {
    when(accounts.findByGoogleSubject(identity.subject())).thenReturn(account);
    when(accounts.lockById(account.id())).thenReturn(account);
    when(issuer.issue(eq(account), any(), any())).thenReturn(session());
    var handler = new GoogleLoginHandler(accounts, transactions, issuer, verifier, CLOCK, 100);
    assertEquals(account.id(), handler.handle("google-token").user().id());
    verify(accounts, never()).insert(any());
  }

  @Test
  void concurrentSubjectCollisionResolvesCommittedOwner() {
    when(accounts.findByGoogleSubject(identity.subject())).thenReturn(null, account, account);
    when(accounts.lockById(account.id())).thenReturn(account);
    when(issuer.issue(eq(account), any(), any())).thenReturn(session());
    // The racing callback commits the subject before this insert finishes.
    when(accounts.emailExists(email)).thenReturn(false);
    var handler = new GoogleLoginHandler(accounts, transactions, issuer, verifier, CLOCK, 100);
    // A generated ID may differ from the committed owner's ID; the DB unique index
    // is the authority, so simulate its conflict at insert.
    org.mockito.Mockito.doThrow(
            new AuthenticationFailure(
                AuthenticationFailure.Reason.EMAIL_ALREADY_REGISTERED, "duplicate"))
        .when(accounts)
        .insert(any());
    assertEquals(account.id(), handler.handle("google-token").user().id());
  }

  private AuthenticationSession session() {
    return new AuthenticationSession(
        "access", "refresh", new UserView(account.id(), email.value(), "Alice"), CLOCK.instant());
  }
}
