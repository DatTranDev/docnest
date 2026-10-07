package vn.editor.identity.auth.application.command;

import java.time.Clock;
import vn.editor.identity.auth.application.port.AccountCommands;
import vn.editor.identity.auth.application.port.RefreshSessions;
import vn.editor.identity.auth.application.port.RefreshTokens;
import vn.editor.identity.auth.application.port.Transactions;
import vn.editor.identity.auth.domain.Account;
import vn.editor.identity.auth.domain.AuthenticationFailure;
import vn.editor.identity.auth.domain.RefreshSession;

public final class RefreshSessionHandler {
  private final AccountCommands accounts;
  private final RefreshSessions sessions;
  private final RefreshTokens tokens;
  private final Transactions transactions;
  private final SessionIssuer issuer;
  private final Clock clock;

  public RefreshSessionHandler(
      AccountCommands accounts,
      RefreshSessions sessions,
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
