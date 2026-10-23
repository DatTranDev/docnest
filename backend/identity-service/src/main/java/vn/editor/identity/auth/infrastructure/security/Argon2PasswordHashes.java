package vn.editor.identity.auth.infrastructure.security;

import java.util.concurrent.Semaphore;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import vn.editor.identity.auth.application.port.PasswordHashes;
import vn.editor.identity.auth.domain.AuthenticationFailure;

public final class Argon2PasswordHashes implements PasswordHashes {
  private final Argon2PasswordEncoder passwords;
  private final Semaphore operations = new Semaphore(2);

  public Argon2PasswordHashes(Argon2PasswordEncoder passwords) {
    this.passwords = passwords;
  }

  @Override
  public String encode(String password) {
    acquire();
    try {
      return passwords.encode(password);
    } finally {
      operations.release();
    }
  }

  @Override
  public boolean matches(String password, String hash) {
    acquire();
    try {
      return passwords.matches(password, hash);
    } finally {
      operations.release();
    }
  }

  private void acquire() {
    if (!operations.tryAcquire())
      throw new AuthenticationFailure(
          AuthenticationFailure.Reason.RATE_LIMITED, "Password processing is busy; retry later");
  }
}
