package vn.editor.identity.auth.application.query;

import java.util.UUID;
import vn.editor.identity.auth.application.port.AccountReadRepository;
import vn.editor.identity.auth.application.port.ServiceCaller;
import vn.editor.identity.auth.domain.AccountEmail;
import vn.editor.identity.auth.domain.AuthenticationFailure;

public final class ResolveAccountHandler implements ResolveAccountService {
  private final AccountReadRepository accounts;
  private final ServiceCaller callers;

  public ResolveAccountHandler(AccountReadRepository accounts, ServiceCaller callers) {
    this.accounts = accounts;
    this.callers = callers;
  }

  public UserView handle(ResolveAccountQuery query) {
    callers.requireDocument(query.callerKey());
    UserView user =
        query.byEmail()
            ? accounts.activeByEmail(new AccountEmail(query.value()))
            : accounts.activeById(UUID.fromString(query.value()).toString());
    if (user == null)
      throw new AuthenticationFailure(
          query.byEmail()
              ? AuthenticationFailure.Reason.USER_NOT_REGISTERED
              : AuthenticationFailure.Reason.ACCOUNT_UNAVAILABLE,
          query.byEmail() ? "Account is not registered" : "Account is unavailable");
    return user;
  }
}
