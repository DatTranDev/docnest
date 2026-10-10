package vn.editor.identity.auth.application.query;

public interface ResolveAccountService {
  UserView handle(ResolveAccountQuery query);
}
