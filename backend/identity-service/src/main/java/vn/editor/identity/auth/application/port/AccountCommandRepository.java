package vn.editor.identity.auth.application.port;

import vn.editor.identity.auth.domain.Account;
import vn.editor.identity.auth.domain.AccountEmail;

public interface AccountCommandRepository {
  void lockRegistrationQuota();

  boolean emailExists(AccountEmail email);

  long countAccounts();

  void insert(Account account);

  Account findByEmail(AccountEmail email);

  Account findByGoogleSubject(String subject);

  void linkGoogleSubject(String subject, String userId, AccountEmail providerEmail);

  void confirmGoogleEmail(String subject, String userId, AccountEmail providerEmail);

  boolean hasGoogleIdentity(String userId);

  void unlinkGoogleIdentity(String userId);

  void setPassword(String userId, String hash);

  void updateGooglePicture(String userId, String pictureUrl);

  void setCustomAvatar(String userId, byte[] image, String mime);

  void removeCustomAvatar(String userId);

  Account lockById(String id);
}
