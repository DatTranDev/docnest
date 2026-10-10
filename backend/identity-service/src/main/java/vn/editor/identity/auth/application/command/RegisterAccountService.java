package vn.editor.identity.auth.application.command;

import vn.editor.identity.auth.application.query.UserView;

public interface RegisterAccountService {
  UserView handle(RegisterAccountCommand command);
}
