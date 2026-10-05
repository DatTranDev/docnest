package vn.editor.document.sharing.application.port;

public interface AccountDirectory {
  record Account(String id, String email, String displayName) {}

  Account resolve(String email, String authorization);

  Account user(String userId, String authorization);
}
