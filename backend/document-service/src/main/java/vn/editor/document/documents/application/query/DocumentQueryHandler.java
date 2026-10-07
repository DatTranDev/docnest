package vn.editor.document.documents.application.query;

import java.io.IOException;
import java.io.InputStream;
import java.time.Instant;
import vn.editor.document.documents.application.port.DocumentReadPort;
import vn.editor.document.documents.application.port.MetadataProjection;
import vn.editor.document.documents.application.port.SnapshotStore;
import vn.editor.document.shared.application.Page;

public final class DocumentQueryHandler {
  private final DocumentReadPort documents;
  private final MetadataProjection cache;
  private final SnapshotStore storage;
  private final String publicBaseUrl;

  public DocumentQueryHandler(
      DocumentReadPort documents,
      MetadataProjection cache,
      SnapshotStore storage,
      String publicBaseUrl) {
    this.documents = documents;
    this.cache = cache;
    this.storage = storage;
    this.publicBaseUrl = publicBaseUrl;
  }

  public DocumentView handle(GetDocumentQuery query) {
    return cache.afterAuthorization(documents.get(query));
  }

  public Page<DocumentView> handle(ListDocumentsQuery query) {
    return documents.list(query);
  }

  public Page<VersionView> handle(ListVersionsQuery query) {
    return documents.versions(query);
  }

  public DownloadView download(GetVersionQuery query) {
    VersionSnapshot snapshot = documents.authorizeVersionAndRecordAccess(query);
    return new DownloadView(
        publicBaseUrl
            + "/api/v1/documents/"
            + query.documentId()
            + "/versions/"
            + query.revision()
            + "/content",
        Instant.now().plusSeconds(60).toString(),
        snapshot.version(),
        snapshot.reference());
  }

  public InputStream content(GetVersionQuery query) throws IOException {
    return storage.read(documents.authorizeVersionAndRecordAccess(query).reference());
  }
}
