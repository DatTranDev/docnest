package vn.editor.identity.auth.application.query;

import vn.editor.identity.auth.domain.Account;

public record UserView(String id, String email, String displayName) {
  public static UserView from(Account account) {
    return new UserView(account.id(), account.email().value(), account.displayName());
  }
}
