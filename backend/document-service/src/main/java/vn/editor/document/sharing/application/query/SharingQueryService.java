package vn.editor.document.sharing.application.query;

import vn.editor.document.shared.application.Page;

public interface SharingQueryService {
  Page<PermissionView> handle(ListPermissionsQuery query);

  Page<LinkView> handle(ListPublicLinksQuery query);
}
