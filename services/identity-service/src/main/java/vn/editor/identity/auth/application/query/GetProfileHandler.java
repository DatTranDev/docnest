package vn.editor.identity.auth.application.query;

import vn.editor.identity.auth.application.port.AccountReads;
import vn.editor.identity.auth.domain.AuthenticationFailure;

public final class GetProfileHandler {
  private final AccountReads accounts;

  public GetProfileHandler(AccountReads accounts) {
    this.accounts = accounts;
  }

  public UserView handle(GetProfileQuery query) {
    UserView user = accounts.activeById(query.userId());
    if (user == null)
      throw new AuthenticationFailure(
          AuthenticationFailure.Reason.ACCOUNT_UNAVAILABLE, "Account is unavailable");
    return user;
  }
}
