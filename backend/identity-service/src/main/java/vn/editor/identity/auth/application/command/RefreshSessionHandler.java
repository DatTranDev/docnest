package vn.editor.identity.auth.application.command;

import java.time.Clock;
import vn.editor.identity.auth.application.port.AccountCommandRepository;
import vn.editor.identity.auth.application.port.RefreshSessionRepository;
import vn.editor.identity.auth.application.port.RefreshTokens;
import vn.editor.identity.auth.application.port.Transactions;
import vn.editor.identity.auth.domain.Account;
import vn.editor.identity.auth.domain.AuthenticationFailure;
import vn.editor.identity.auth.domain.RefreshSession;

public final class RefreshSessionHandler implements RefreshSessionService {
  private final AccountCommandRepository accounts;
  private final RefreshSessionRepository sessions;
  private final RefreshTokens tokens;
  private final Transactions transactions;
  private final SessionIssuer issuer;
  private final Clock clock;

  public RefreshSessionHandler(
      AccountCommandRepository accounts,
      RefreshSessionRepository sessions,
      RefreshTokens tokens,
      Transactions transactions,
      SessionIssuer issuer,
      Clock clock) {
    this.accounts = accounts;
    this.sessions = sessions;
    this.tokens = tokens;
    this.transactions = transactions;
    this.issuer = issuer;
    this.clock = clock;
  }

  public AuthenticationSession handle(RefreshSessionCommand command) {
    String raw = command.refreshToken();
    if (!RefreshSession.validRawToken(raw)) throw AuthenticationFailure.credentials();
    String fingerprint = tokens.fingerprint(raw), userId = sessions.findUserId(fingerprint);
    if (userId == null) throw AuthenticationFailure.credentials();
    AuthenticationSession result =
        transactions.execute(
            () -> {
              Account account = accounts.lockById(userId);
              RefreshSession session = sessions.lockByFingerprint(fingerprint);
              if (session == null) return null;
              if (!session.mayRotate(account, clock.instant())) {
                sessions.revokeFamily(session.familyId());
                return null;
              }
              sessions.markUsed(session.id());
              return issuer.issue(account, session.familyId(), session.expiresAt());
            }); /* Revocation must commit before rejection escapes the transaction. */
    if (result == null) throw AuthenticationFailure.credentials();
    return result;
  }
}
