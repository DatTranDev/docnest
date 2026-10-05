package vn.editor.identity.auth.infrastructure.security;

import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import vn.editor.identity.auth.application.port.PasswordHashes;

public final class Argon2PasswordHashes implements PasswordHashes {
  private final Argon2PasswordEncoder passwords;

  public Argon2PasswordHashes(Argon2PasswordEncoder passwords) {
    this.passwords = passwords;
  }

  @Override
  public String encode(String password) {
    return passwords.encode(password);
  }

  @Override
  public boolean matches(String password, String hash) {
    return passwords.matches(password, hash);
  }
}
