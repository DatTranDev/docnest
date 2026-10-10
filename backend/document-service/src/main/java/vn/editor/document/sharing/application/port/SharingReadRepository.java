package vn.editor.document.sharing.application.port;

import vn.editor.document.documents.application.port.SnapshotStore.ObjectReference;
import vn.editor.document.shared.application.Page;
import vn.editor.document.sharing.application.query.LinkView;
import vn.editor.document.sharing.application.query.ListPermissionsQuery;
import vn.editor.document.sharing.application.query.ListPublicLinksQuery;
import vn.editor.document.sharing.application.query.PermissionView;
import vn.editor.document.sharing.application.query.PublicDocumentView;

public interface SharingReadRepository {
  Page<PermissionView> permissions(ListPermissionsQuery query);

  Page<LinkView> links(ListPublicLinksQuery query);

  PublicDocumentView publicDocument(String token);

  ObjectReference authorizePublicContentAndRecordAccess(String token);
}
