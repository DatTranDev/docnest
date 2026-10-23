package vn.editor.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import vn.editor.identity.auth.application.command.RegisterAccountCommand;
import vn.editor.identity.auth.application.command.RegisterAccountHandler;
import vn.editor.identity.auth.application.port.AccountCommandRepository;
import vn.editor.identity.auth.application.port.PasswordHashes;
import vn.editor.identity.auth.application.port.Transactions;
import vn.editor.identity.auth.domain.AccountEmail;
import vn.editor.identity.auth.domain.AuthenticationFailure;

class RegistrationSecurityTest {
  private final AccountCommandRepository accounts = mock(AccountCommandRepository.class);
  private final PasswordHashes passwords = mock(PasswordHashes.class);
  private final Transactions transactions =
      new Transactions() {
        @Override
        public <T> T execute(Supplier<T> operation) {
          return operation.get();
        }
      };
  private final RegisterAccountHandler handler =
      new RegisterAccountHandler(accounts, passwords, transactions, Clock.systemUTC(), 10, true);
  private final RegisterAccountCommand command =
      new RegisterAccountCommand("alice@example.com", "a valid long password", "Alice");

  @Test
  void closedRegistrationDoesNotHashOrCreateAccounts() {
    var closed =
        new RegisterAccountHandler(accounts, passwords, transactions, Clock.systemUTC(), 10, false);
    assertEquals(
        AuthenticationFailure.Reason.REGISTRATION_CLOSED,
        assertThrows(AuthenticationFailure.class, () -> closed.handle(command)).reason());
    verify(passwords, never()).encode(any());
    verify(accounts, never()).insert(any());
  }

  @Test
  void duplicateEmailAndFullQuotaNeverStartPasswordHashing() {
    when(accounts.emailExists(new AccountEmail(command.email()))).thenReturn(true);
    assertEquals(
        AuthenticationFailure.Reason.EMAIL_ALREADY_REGISTERED,
        assertThrows(AuthenticationFailure.class, () -> handler.handle(command)).reason());
    when(accounts.emailExists(new AccountEmail(command.email()))).thenReturn(false);
    when(accounts.countAccounts()).thenReturn(10L);
    assertEquals(
        AuthenticationFailure.Reason.ACCOUNT_QUOTA,
        assertThrows(AuthenticationFailure.class, () -> handler.handle(command)).reason());
    verify(passwords, never()).encode(any());
    verify(accounts, never()).lockRegistrationQuota();
    verify(accounts, never()).insert(any());
  }

  @Test
  void quotaIsRecheckedUnderTheLockWhenAnotherRegistrationWinsDuringHashing() {
    when(accounts.countAccounts()).thenReturn(9L, 10L);
    when(passwords.encode(command.password())).thenReturn("hash");
    assertEquals(
        AuthenticationFailure.Reason.ACCOUNT_QUOTA,
        assertThrows(AuthenticationFailure.class, () -> handler.handle(command)).reason());
    verify(passwords).encode(command.password());
    verify(accounts).lockRegistrationQuota();
    verify(accounts, never()).insert(any());
  }
}
