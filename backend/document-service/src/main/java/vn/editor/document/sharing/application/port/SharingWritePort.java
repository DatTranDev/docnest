package vn.editor.document.sharing.application.port;

import java.util.function.Supplier;
import vn.editor.document.sharing.application.command.CreatePublicLinkCommand;
import vn.editor.document.sharing.application.command.CreatedLink;
import vn.editor.document.sharing.application.command.GrantDocumentAccessCommand;
import vn.editor.document.sharing.application.command.RevokeDocumentAccessCommand;
import vn.editor.document.sharing.application.command.RevokePublicLinkCommand;
import vn.editor.document.sharing.application.query.PermissionView;

public interface SharingWritePort {
  record LinkSecret(String token, String hash) {}

  <T> T execute(Supplier<T> action);

  LinkSecret newLinkSecret();

  PermissionView grant(GrantDocumentAccessCommand command);

  void revoke(RevokeDocumentAccessCommand command);

  CreatedLink createLink(CreatePublicLinkCommand command, LinkSecret secret);

  void revokeLink(RevokePublicLinkCommand command);
}
