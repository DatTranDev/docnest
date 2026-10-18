package vn.editor.document.sharing.application.port;

public interface AccountDirectory {
  record Account(String id, String email, String displayName, String avatarUrl) {
    public Account(String id, String email, String displayName) {
      this(id, email, displayName, null);
    }
  }

  Account resolve(String email, String authorization);

  Account user(String userId, String authorization);
}
