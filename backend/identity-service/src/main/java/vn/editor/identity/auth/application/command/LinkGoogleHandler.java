package vn.editor.identity.auth.application.command;

import java.time.Clock;
import java.util.UUID;
import vn.editor.identity.auth.application.port.AccountCommandRepository;
import vn.editor.identity.auth.application.port.GoogleIdentityVerifier;
import vn.editor.identity.auth.application.port.PasswordHashes;
import vn.editor.identity.auth.application.port.Transactions;
import vn.editor.identity.auth.domain.Account;
import vn.editor.identity.auth.domain.AccountEmail;
import vn.editor.identity.auth.domain.AuthenticationFailure;
import vn.editor.identity.auth.domain.RefreshSession;

public final class LinkGoogleHandler implements LinkGoogleService {
  private final AccountCommandRepository accounts;
  private final PasswordHashes passwords;
  private final GoogleIdentityVerifier identities;
  private final Transactions transactions;
  private final SessionIssuer issuer;
  private final Clock clock;

  public LinkGoogleHandler(
      AccountCommandRepository accounts,
      PasswordHashes passwords,
      GoogleIdentityVerifier identities,
      Transactions transactions,
      SessionIssuer issuer,
      Clock clock) {
    this.accounts = accounts;
    this.passwords = passwords;
    this.identities = identities;
    this.transactions = transactions;
    this.issuer = issuer;
    this.clock = clock;
  }

  @Override
  public AuthenticationSession handle(String email, String password, String credential) {
    var identity = identities.verify(credential);
    AccountEmail normalized = new AccountEmail(email);
    if (!identity.email().equals(normalized)) throw AuthenticationFailure.credentials();
    Account candidate = accounts.findByEmail(normalized);
    if (candidate == null
        || candidate.passwordHash() == null
        || !passwords.matches(password, candidate.passwordHash()))
      throw AuthenticationFailure.credentials();
    return transactions.execute(
        () -> {
          Account locked = accounts.lockById(candidate.id());
          locked.requireActive();
          if (locked.passwordHash() == null || !passwords.matches(password, locked.passwordHash()))
            throw AuthenticationFailure.credentials();
          Account linked = accounts.findByGoogleSubject(identity.subject());
          if (linked != null && !linked.id().equals(locked.id())) throw conflict();
          if (linked == null) {
            if (accounts.hasGoogleIdentity(locked.id())) throw conflict();
            accounts.linkGoogleSubject(identity.subject(), locked.id(), identity.email());
          }
          accounts.confirmGoogleEmail(identity.subject(), locked.id(), identity.email());
          accounts.updateGooglePicture(locked.id(), identity.pictureUrl());
          return issuer.issue(
              accounts.lockById(locked.id()),
              UUID.randomUUID().toString(),
              RefreshSession.newFamilyExpiry(clock.instant()));
        });
  }

  private AuthenticationFailure conflict() {
    return new AuthenticationFailure(
        AuthenticationFailure.Reason.IDENTITY_CONFLICT, "Google identity is already linked");
  }
}
