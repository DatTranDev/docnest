package vn.editor.identity.auth.application.command;

import java.time.Clock;
import java.util.UUID;
import vn.editor.identity.auth.application.port.AccountCommandRepository;
import vn.editor.identity.auth.application.port.PasswordHashes;
import vn.editor.identity.auth.application.port.Transactions;
import vn.editor.identity.auth.domain.Account;
import vn.editor.identity.auth.domain.AccountEmail;
import vn.editor.identity.auth.domain.AuthenticationFailure;
import vn.editor.identity.auth.domain.RefreshSession;
import vn.editor.identity.auth.domain.RegistrationPolicy;

public final class LoginHandler implements LoginService {
  private final AccountCommandRepository accounts;
  private final PasswordHashes passwords;
  private final Transactions transactions;
  private final SessionIssuer issuer;
  private final Clock clock;
  private final String dummyHash;

  public LoginHandler(
      AccountCommandRepository accounts,
      PasswordHashes passwords,
      Transactions transactions,
      SessionIssuer issuer,
      Clock clock) {
    this.accounts = accounts;
    this.passwords = passwords;
    this.transactions = transactions;
    this.issuer = issuer;
    this.clock = clock;
    dummyHash = passwords.encode(UUID.randomUUID().toString());
  }

  public AuthenticationSession handle(LoginCommand command) {
    AccountEmail email = new AccountEmail(command.email());
    RegistrationPolicy.validatePassword(command.password(), false);
    Account account = accounts.findByEmail(email);
    boolean matches =
        passwords.matches(command.password(), account == null ? dummyHash : account.passwordHash());
    if (account == null || !matches) throw AuthenticationFailure.credentials();
    account.requireActive();
    return transactions.execute(
        () -> {
          Account current = accounts.lockById(account.id());
          current.requireActive();
          return issuer.issue(
              current,
              UUID.randomUUID().toString(),
              RefreshSession.newFamilyExpiry(clock.instant()));
        });
  }
}
