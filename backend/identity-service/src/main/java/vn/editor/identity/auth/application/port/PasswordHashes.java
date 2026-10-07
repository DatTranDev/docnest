package vn.editor.identity.auth.application.port;

public interface PasswordHashes {
  String encode(String password);

  boolean matches(String password, String hash);
}
