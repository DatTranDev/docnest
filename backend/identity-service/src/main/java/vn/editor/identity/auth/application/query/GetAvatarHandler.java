package vn.editor.identity.auth.application.query;

import vn.editor.identity.auth.application.port.AccountReadRepository;

public final class GetAvatarHandler implements GetAvatarService {
  private final AccountReadRepository accounts;

  public GetAvatarHandler(AccountReadRepository accounts) {
    this.accounts = accounts;
  }

  @Override
  public AvatarImage handle(String userId) {
    return accounts.avatarById(userId);
  }
}
