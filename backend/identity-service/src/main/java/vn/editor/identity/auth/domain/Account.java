package vn.editor.identity.auth.domain;

import java.time.Instant;

public record Account(
    String id,
    AccountEmail email,
    String passwordHash,
    String displayName,
    boolean active,
    Instant createdAt) {
  public void requireActive() {
    if (!active) throw AuthenticationFailure.credentials();
  }
}
