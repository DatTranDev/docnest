package vn.editor.identity.auth.application.port;

import vn.editor.identity.auth.application.query.UserView;
import vn.editor.identity.auth.domain.AccountEmail;

public interface AccountReads {
  UserView activeById(String id);

  UserView activeByEmail(AccountEmail email);
}
