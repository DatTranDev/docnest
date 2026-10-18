package vn.editor.identity.auth.application.query;

import vn.editor.identity.auth.domain.Account;

public record UserView(
    String id, String email, String displayName, String avatarSource, String avatarUrl) {
  public UserView(String id, String email, String displayName) {
    this(id, email, displayName, "GENERATED", null);
  }

  public static UserView from(Account account) {
    return new UserView(
        account.id(),
        account.email().value(),
        account.displayName(),
        account.avatarSource(),
        account.avatarUrl());
  }
}
