package vn.editor.identity.auth.application.command;

import vn.editor.identity.auth.application.port.AccountCommandRepository;
import vn.editor.identity.auth.application.port.GoogleIdentityVerifier;
import vn.editor.identity.auth.application.port.PasswordHashes;
import vn.editor.identity.auth.application.port.Transactions;
import vn.editor.identity.auth.domain.AuthenticationFailure;
import vn.editor.identity.auth.domain.RegistrationPolicy;

public final class ManageCredentialsHandler implements ManageCredentialsService {
  private final AccountCommandRepository accounts;
  private final PasswordHashes passwords;
  private final GoogleIdentityVerifier identities;
  private final Transactions transactions;

  public ManageCredentialsHandler(
      AccountCommandRepository accounts,
      PasswordHashes passwords,
      GoogleIdentityVerifier identities,
      Transactions transactions) {
    this.accounts = accounts;
    this.passwords = passwords;
    this.identities = identities;
    this.transactions = transactions;
  }

  @Override
  public void setupPassword(String userId, String newPassword, String googleCredential) {
    RegistrationPolicy.validatePassword(newPassword, true);
    var identity = identities.verify(googleCredential);
    String hash = passwords.encode(newPassword);
    transactions.execute(
        () -> {
          var account = accounts.lockById(userId);
          account.requireActive();
          var linked = accounts.findByGoogleSubject(identity.subject());
          if (linked == null || !linked.id().equals(userId))
            throw AuthenticationFailure.credentials();
          accounts.setPassword(userId, hash);
          return null;
        });
  }

  @Override
  public void unlinkGoogle(String userId, String currentPassword) {
    transactions.execute(
        () -> {
          var account = accounts.lockById(userId);
          account.requireActive();
          if (account.passwordHash() == null)
            throw new AuthenticationFailure(
                AuthenticationFailure.Reason.LAST_CREDENTIAL,
                "Set a password before unlinking Google");
          if (!passwords.matches(currentPassword, account.passwordHash()))
            throw AuthenticationFailure.credentials();
          accounts.unlinkGoogleIdentity(userId);
          return null;
        });
  }
}
