package vn.editor.identity.auth.application.command;

import java.time.Clock;
import java.util.UUID;
import vn.editor.identity.auth.application.port.AccountCommandRepository;
import vn.editor.identity.auth.application.port.GoogleIdentity;
import vn.editor.identity.auth.application.port.GoogleIdentityVerifier;
import vn.editor.identity.auth.application.port.Transactions;
import vn.editor.identity.auth.domain.Account;
import vn.editor.identity.auth.domain.AuthenticationFailure;
import vn.editor.identity.auth.domain.RefreshSession;
import vn.editor.identity.auth.domain.RegistrationPolicy;

public final class GoogleLoginHandler implements GoogleLoginService {
  private final AccountCommandRepository accounts;
  private final Transactions transactions;
  private final SessionIssuer issuer;
  private final GoogleIdentityVerifier identities;
  private final Clock clock;
  private final int maximumAccounts;
  private final boolean registrationEnabled;

  public GoogleLoginHandler(
      AccountCommandRepository accounts,
      Transactions transactions,
      SessionIssuer issuer,
      GoogleIdentityVerifier identities,
      Clock clock,
      int maximumAccounts,
      boolean registrationEnabled) {
    this.accounts = accounts;
    this.transactions = transactions;
    this.issuer = issuer;
    this.identities = identities;
    this.clock = clock;
    this.maximumAccounts = maximumAccounts;
    this.registrationEnabled = registrationEnabled;
  }

  @Override
  public AuthenticationSession handle(String credential) {
    GoogleIdentity identity = identities.verify(credential);
    try {
      return signIn(identity);
    } catch (AuthenticationFailure duplicate) {
      // A concurrent callback may have committed the subject or email while this
      // transaction was waiting on a unique index. Resolve the final owner anew.
      Account linked = accounts.findByGoogleSubject(identity.subject());
      if (linked != null) return signIn(identity);
      if (duplicate.reason() != AuthenticationFailure.Reason.EMAIL_ALREADY_REGISTERED
          && duplicate.reason() != AuthenticationFailure.Reason.IDENTITY_CONFLICT) throw duplicate;
      throw new AuthenticationFailure(
          AuthenticationFailure.Reason.GOOGLE_LINK_REQUIRED,
          "Sign in with your existing account to link Google");
    }
  }

  private AuthenticationSession signIn(GoogleIdentity identity) {
    return transactions.execute(
        () -> {
          Account account = accounts.findByGoogleSubject(identity.subject());
          if (account == null) {
            accounts.lockRegistrationQuota();
            if (accounts.emailExists(identity.email()))
              throw new AuthenticationFailure(
                  AuthenticationFailure.Reason.GOOGLE_LINK_REQUIRED,
                  "Sign in with your existing account to link Google");
            RegistrationPolicy.requireOpen(registrationEnabled);
            RegistrationPolicy.requireCapacity(false, accounts.countAccounts(), maximumAccounts);
            String displayName = identity.displayName();
            if (displayName == null || displayName.isBlank())
              displayName = identity.email().value();
            if (displayName.codePointCount(0, displayName.length()) > 100)
              displayName = displayName.substring(0, displayName.offsetByCodePoints(0, 100));
            RegistrationPolicy.validateDisplayName(displayName);
            account =
                new Account(
                    UUID.randomUUID().toString(),
                    identity.email(),
                    null,
                    displayName,
                    true,
                    clock.instant());
            accounts.insert(account);
            accounts.linkGoogleSubject(identity.subject(), account.id(), identity.email());
          } else {
            account = accounts.lockById(account.id());
            account.requireActive();
          }
          accounts.confirmGoogleEmail(identity.subject(), account.id(), identity.email());
          accounts.updateGooglePicture(account.id(), identity.pictureUrl());
          account = accounts.lockById(account.id());
          return issuer.issue(
              account,
              UUID.randomUUID().toString(),
              RefreshSession.newFamilyExpiry(clock.instant()));
        });
  }
}
