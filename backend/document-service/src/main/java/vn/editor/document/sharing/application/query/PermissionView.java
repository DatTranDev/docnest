package vn.editor.document.sharing.application.query;

public record PermissionView(
    String granteeUserId, String role, String updatedAt, String email, String displayName) {
  public PermissionView(String user, String role, String at) {
    this(user, role, at, null, null);
  }
}
