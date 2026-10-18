package vn.editor.identity.auth.domain;

import java.time.Instant;

public record Account(
    String id,
    AccountEmail email,
    String passwordHash,
    String displayName,
    boolean active,
    Instant createdAt,
    String avatarSource,
    String avatarUrl) {
  public Account(
      String id,
      AccountEmail email,
      String passwordHash,
      String displayName,
      boolean active,
      Instant createdAt) {
    this(id, email, passwordHash, displayName, active, createdAt, "GENERATED", null);
  }

  public void requireActive() {
    if (!active) throw AuthenticationFailure.credentials();
  }
}
