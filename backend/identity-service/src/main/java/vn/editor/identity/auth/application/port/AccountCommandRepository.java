package vn.editor.identity.auth.application.port;

import vn.editor.identity.auth.domain.Account;
import vn.editor.identity.auth.domain.AccountEmail;

public interface AccountCommandRepository {
  void lockRegistrationQuota();

  boolean emailExists(AccountEmail email);

  long countAccounts();

  void insert(Account account);

  Account findByEmail(AccountEmail email);

  Account lockById(String id);
}
