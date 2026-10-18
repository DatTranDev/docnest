package vn.editor.identity.auth.application.query;

public interface GetCredentialStatusService {
  CredentialStatus handle(String userId);
}
