package vn.editor.identity.auth.application.command;

import vn.editor.identity.auth.application.port.AccountCommandRepository;
import vn.editor.identity.auth.application.port.RefreshSessionRepository;
import vn.editor.identity.auth.application.port.RefreshTokens;
import vn.editor.identity.auth.application.port.Transactions;
import vn.editor.identity.auth.domain.RefreshSession;

public final class LogoutHandler implements LogoutService {
  private final AccountCommandRepository accounts;
  private final RefreshSessionRepository sessions;
  private final RefreshTokens tokens;
  private final Transactions transactions;

  public LogoutHandler(
      AccountCommandRepository accounts,
      RefreshSessionRepository sessions,
      RefreshTokens tokens,
      Transactions transactions) {
    this.accounts = accounts;
    this.sessions = sessions;
    this.tokens = tokens;
    this.transactions = transactions;
  }

  public void handle(LogoutCommand command) {
    if (command.refreshToken() == null) return;
    String fingerprint = tokens.fingerprint(command.refreshToken()),
        userId = sessions.findUserId(fingerprint);
    if (userId == null) return;
    transactions.execute(
        () -> {
          accounts.lockById(userId);
          RefreshSession session = sessions.lockByFingerprint(fingerprint);
          if (session != null) sessions.revokeFamily(session.familyId());
        });
  }
}
