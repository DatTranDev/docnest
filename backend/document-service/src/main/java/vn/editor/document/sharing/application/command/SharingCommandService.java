package vn.editor.document.sharing.application.command;

import vn.editor.document.sharing.application.query.PermissionView;

public interface SharingCommandService {
  PermissionView handle(GrantDocumentAccessByEmailCommand command);

  PermissionView handle(GrantDocumentAccessCommand command);

  void handle(RevokeDocumentAccessCommand command);

  CreatedLink handle(CreatePublicLinkCommand command);

  void handle(RevokePublicLinkCommand command);
}
