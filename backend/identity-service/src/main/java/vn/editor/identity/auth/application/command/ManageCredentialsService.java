package vn.editor.identity.auth.application.command;

public interface ManageCredentialsService {
  void setupPassword(String userId, String newPassword, String googleCredential);

  void unlinkGoogle(String userId, String currentPassword);
}
