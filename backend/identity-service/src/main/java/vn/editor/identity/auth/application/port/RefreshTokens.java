package vn.editor.identity.auth.application.port;

public interface RefreshTokens {
  String generate();

  String fingerprint(String raw);
}
