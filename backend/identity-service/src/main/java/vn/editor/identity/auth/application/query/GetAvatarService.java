package vn.editor.identity.auth.application.query;

public interface GetAvatarService {
  AvatarImage handle(String userId);
}
