package vn.editor.document.documents.application.query;

import java.io.IOException;
import java.io.InputStream;
import vn.editor.document.shared.application.Page;

public interface DocumentQueryService {
  DocumentView handle(GetDocumentQuery query);

  Page<DocumentView> handle(ListDocumentsQuery query);

  Page<VersionView> handle(ListVersionsQuery query);

  DownloadView download(GetVersionQuery query);

  InputStream content(GetVersionQuery query) throws IOException;
}
