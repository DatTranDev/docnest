package vn.editor.identity.auth.application.command;

import java.time.Clock;
import java.util.UUID;
import vn.editor.identity.auth.application.port.AccountCommandRepository;
import vn.editor.identity.auth.application.port.PasswordHashes;
import vn.editor.identity.auth.application.port.Transactions;
import vn.editor.identity.auth.application.query.UserView;
import vn.editor.identity.auth.domain.Account;
import vn.editor.identity.auth.domain.AccountEmail;
import vn.editor.identity.auth.domain.RegistrationPolicy;

public final class RegisterAccountHandler implements RegisterAccountService {
  private final AccountCommandRepository accounts;
  private final PasswordHashes passwords;
  private final Transactions transactions;
  private final Clock clock;
  private final int maximumAccounts;

  public RegisterAccountHandler(
      AccountCommandRepository accounts,
      PasswordHashes passwords,
      Transactions transactions,
      Clock clock,
      int maximumAccounts) {
    this.accounts = accounts;
    this.passwords = passwords;
    this.transactions = transactions;
    this.clock = clock;
    this.maximumAccounts = maximumAccounts;
  }

  public UserView handle(RegisterAccountCommand command) {
    AccountEmail email = new AccountEmail(command.email());
    RegistrationPolicy.validatePassword(command.password(), true);
    RegistrationPolicy.validateDisplayName(command.displayName());
    String hash = passwords.encode(command.password());
    return transactions.execute(
        () -> {
          accounts.lockRegistrationQuota();
          RegistrationPolicy.requireCapacity(
              accounts.emailExists(email), accounts.countAccounts(), maximumAccounts);
          Account account =
              new Account(
                  UUID.randomUUID().toString(),
                  email,
                  hash,
                  command.displayName(),
                  true,
                  clock.instant());
          accounts.insert(account);
          return UserView.from(account);
        });
  }
}
