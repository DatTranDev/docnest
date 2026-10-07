package vn.editor.identity.auth.application.port;

public interface LoginAttempts {
  void attempt(String address);
}
