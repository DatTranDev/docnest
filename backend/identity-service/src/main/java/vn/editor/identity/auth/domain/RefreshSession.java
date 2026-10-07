package vn.editor.identity.auth.domain;

import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

public record RefreshSession(
    String id,
    String userId,
    String familyId,
    String tokenFingerprint,
    Instant expiresAt,
    boolean used,
    boolean revoked) {
  public static final Duration FAMILY_LIFETIME = Duration.ofDays(14);

  public static Instant newFamilyExpiry(Instant now) {
    return now.plus(FAMILY_LIFETIME).truncatedTo(ChronoUnit.MICROS);
  }

  public static boolean validRawToken(String raw) {
    return raw != null && raw.matches("[A-Za-z0-9_-]{43}");
  }

  public boolean mayRotate(Account account, Instant now) {
    return !used && !revoked && account.active() && expiresAt.isAfter(now);
  }
}
