package vn.editor.identity.auth.application.command;

import java.time.Clock;
import java.util.UUID;
import vn.editor.identity.auth.application.port.AccountCommandRepository;
import vn.editor.identity.auth.application.port.GoogleIdentity;
import vn.editor.identity.auth.application.port.GoogleIdentityVerifier;
import vn.editor.identity.auth.application.port.PasswordHashes;
import vn.editor.identity.auth.application.port.Transactions;
import vn.editor.identity.auth.domain.Account;
import vn.editor.identity.auth.domain.AccountEmail;
import vn.editor.identity.auth.domain.RefreshSession;
import vn.editor.identity.auth.domain.RegistrationPolicy;

public final class GoogleLoginHandler implements GoogleLoginService {
  private final AccountCommandRepository accounts;
  private final PasswordHashes passwords;
  private final Transactions transactions;
  private final SessionIssuer issuer;
  private final GoogleIdentityVerifier identities;
  private final Clock clock;
  private final int maximumAccounts;

  public GoogleLoginHandler(
      AccountCommandRepository accounts,
      PasswordHashes passwords,
      Transactions transactions,
      SessionIssuer issuer,
      GoogleIdentityVerifier identities,
      Clock clock,
      int maximumAccounts) {
    this.accounts = accounts;
    this.passwords = passwords;
    this.transactions = transactions;
    this.issuer = issuer;
    this.identities = identities;
    this.clock = clock;
    this.maximumAccounts = maximumAccounts;
  }

  @Override
  public AuthenticationSession handle(String credential) {
    GoogleIdentity identity = identities.verify(credential);
    String subject = identity.subject();
    AccountEmail email = identity.email();
    String googleName = identity.displayName();
    return transactions.execute(
        () -> {
          Account account = accounts.findByGoogleSubject(subject);
          if (account == null) {
            account = accounts.findByEmail(email);
            if (account == null) {
              accounts.lockRegistrationQuota();
              RegistrationPolicy.requireCapacity(
                  accounts.emailExists(email), accounts.countAccounts(), maximumAccounts);
              String displayName = googleName;
              if (displayName == null || displayName.isBlank()) displayName = email.value();
              if (displayName.codePointCount(0, displayName.length()) > 100)
                displayName = displayName.substring(0, displayName.offsetByCodePoints(0, 100));
              RegistrationPolicy.validateDisplayName(displayName);
              account =
                  new Account(
                      UUID.randomUUID().toString(),
                      email,
                      passwords.encode(UUID.randomUUID().toString() + UUID.randomUUID()),
                      displayName,
                      true,
                      clock.instant());
              accounts.insert(account);
            } else {
              account = accounts.lockById(account.id());
              account.requireActive();
            }
            accounts.linkGoogleSubject(subject, account.id());
          } else {
            account = accounts.lockById(account.id());
            account.requireActive();
          }
          return issuer.issue(
              account,
              UUID.randomUUID().toString(),
              RefreshSession.newFamilyExpiry(clock.instant()));
        });
  }
}
