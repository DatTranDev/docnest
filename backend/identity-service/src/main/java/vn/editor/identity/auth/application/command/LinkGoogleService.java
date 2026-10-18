package vn.editor.identity.auth.application.command;

public interface LinkGoogleService {
  AuthenticationSession handle(String email, String password, String credential);
}
