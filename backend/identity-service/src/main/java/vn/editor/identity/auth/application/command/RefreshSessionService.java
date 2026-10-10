package vn.editor.identity.auth.application.command;

public interface RefreshSessionService {
  AuthenticationSession handle(RefreshSessionCommand command);
}
