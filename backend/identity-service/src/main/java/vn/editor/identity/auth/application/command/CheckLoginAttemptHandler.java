package vn.editor.identity.auth.application.command;

import vn.editor.identity.auth.application.port.LoginAttempts;

public final class CheckLoginAttemptHandler implements CheckLoginAttemptService {
  private final LoginAttempts attempts;

  public CheckLoginAttemptHandler(LoginAttempts attempts) {
    this.attempts = attempts;
  }

  public void handle(CheckLoginAttemptCommand command) {
    attempts.attempt(command.address());
  }
}
