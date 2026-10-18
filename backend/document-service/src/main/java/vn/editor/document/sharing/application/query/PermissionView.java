package vn.editor.document.sharing.application.query;

public record PermissionView(
    String granteeUserId,
    String role,
    String updatedAt,
    String email,
    String displayName,
    String avatarUrl) {
  public PermissionView(String user, String role, String at) {
    this(user, role, at, null, null, null);
  }

  public PermissionView(String user, String role, String at, String email, String name) {
    this(user, role, at, email, name, null);
  }
}
