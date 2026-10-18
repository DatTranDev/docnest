package vn.editor.identity.auth.application.command;

public interface ChangeAvatarService {
  void upload(String userId, byte[] source, String mime);

  void remove(String userId);
}
