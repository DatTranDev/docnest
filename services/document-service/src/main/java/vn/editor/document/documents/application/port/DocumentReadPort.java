package vn.editor.document.documents.application.port;

import vn.editor.document.documents.application.query.DocumentView;
import vn.editor.document.documents.application.query.GetDocumentQuery;
import vn.editor.document.documents.application.query.GetVersionQuery;
import vn.editor.document.documents.application.query.ListDocumentsQuery;
import vn.editor.document.documents.application.query.ListVersionsQuery;
import vn.editor.document.documents.application.query.VersionSnapshot;
import vn.editor.document.documents.application.query.VersionView;
import vn.editor.document.shared.application.Page;

public interface DocumentReadPort {
  DocumentView get(GetDocumentQuery query);

  Page<DocumentView> list(ListDocumentsQuery query);

  Page<VersionView> versions(ListVersionsQuery query);

  VersionSnapshot authorizeVersionAndRecordAccess(GetVersionQuery query);
}
