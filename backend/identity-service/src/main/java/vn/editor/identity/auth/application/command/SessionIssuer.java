package vn.editor.identity.auth.application.command;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import vn.editor.identity.auth.application.port.AccessTokens;
import vn.editor.identity.auth.application.port.RefreshSessions;
import vn.editor.identity.auth.application.port.RefreshTokens;
import vn.editor.identity.auth.application.query.UserView;
import vn.editor.identity.auth.domain.Account;
import vn.editor.identity.auth.domain.RefreshSession;

/**
 * Called within the caller's SQL transaction: family persistence and the issued response are
 * atomic.
 */
public final class SessionIssuer {
  private final RefreshSessions sessions;
  private final RefreshTokens refreshTokens;
  private final AccessTokens accessTokens;

  public SessionIssuer(
      RefreshSessions sessions, RefreshTokens refreshTokens, AccessTokens accessTokens) {
    this.sessions = sessions;
    this.refreshTokens = refreshTokens;
    this.accessTokens = accessTokens;
  }

  public AuthenticationSession issue(Account account, String family, Instant expiry) {
    String raw = refreshTokens.generate();
    Instant absolute = expiry.truncatedTo(ChronoUnit.MICROS);
    sessions.insert(
        new RefreshSession(
            UUID.randomUUID().toString(),
            account.id(),
            family,
            refreshTokens.fingerprint(raw),
            absolute,
            false,
            false));
    return new AuthenticationSession(
        accessTokens.issue(account.id()), raw, UserView.from(account), absolute);
  }
}
