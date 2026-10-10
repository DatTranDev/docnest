package vn.editor.identity.auth.application.command;

public interface LoginService {
  AuthenticationSession handle(LoginCommand command);
}
