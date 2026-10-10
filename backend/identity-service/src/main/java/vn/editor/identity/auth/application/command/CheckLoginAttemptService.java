package vn.editor.identity.auth.application.command;

public interface CheckLoginAttemptService {
  void handle(CheckLoginAttemptCommand command);
}
