package vn.editor.identity.auth.application.query;

public record PublicProfileView(
    String id, String displayName, String avatarSource, String avatarUrl) {
  public static PublicProfileView from(UserView user) {
    return new PublicProfileView(
        user.id(), user.displayName(), user.avatarSource(), user.avatarUrl());
  }
}
