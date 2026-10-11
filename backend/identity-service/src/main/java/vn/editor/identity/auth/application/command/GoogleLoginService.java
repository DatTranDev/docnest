package vn.editor.identity.auth.application.command;

public interface GoogleLoginService {
  AuthenticationSession handle(String credential);
}
