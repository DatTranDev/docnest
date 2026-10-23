package vn.editor.identity.auth.application.port;

import vn.editor.identity.auth.application.query.AvatarImage;
import vn.editor.identity.auth.application.query.CredentialStatus;
import vn.editor.identity.auth.application.query.UserView;
import vn.editor.identity.auth.domain.AccountEmail;

public interface AccountReadRepository {
  UserView activeById(String id);

  UserView activeByEmail(AccountEmail email);

  boolean hasVerifiedEmail(String userId, AccountEmail email);

  AvatarImage avatarById(String userId);

  CredentialStatus credentialStatus(String userId);
}
