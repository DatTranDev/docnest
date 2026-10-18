package vn.editor.identity.auth.application.query;

import vn.editor.identity.auth.application.port.AccountReadRepository;

public final class GetCredentialStatusHandler implements GetCredentialStatusService {
  private final AccountReadRepository accounts;

  public GetCredentialStatusHandler(AccountReadRepository accounts) {
    this.accounts = accounts;
  }

  @Override
  public CredentialStatus handle(String userId) {
    return accounts.credentialStatus(userId);
  }
}
