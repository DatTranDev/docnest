package vn.editor.document.sharing.application.query;

import java.io.IOException;
import vn.editor.document.documents.application.port.SnapshotStore;
import vn.editor.document.sharing.application.port.PublicTrafficLimit;
import vn.editor.document.sharing.application.port.SharingReadRepository;

public final class PublicShareQueryHandler implements PublicShareQueryService {
  private final SharingReadRepository sharing;
  private final SnapshotStore storage;
  private final PublicTrafficLimit traffic;

  public PublicShareQueryHandler(
      SharingReadRepository sharing, SnapshotStore storage, PublicTrafficLimit traffic) {
    this.sharing = sharing;
    this.storage = storage;
    this.traffic = traffic;
  }

  public PublicDocumentView document(String token, String address) {
    traffic.take(address, false);
    return sharing.publicDocument(token);
  }

  public PublicShareContent content(String token, String address) throws IOException {
    traffic.take(address, true);
    PublicTrafficLimit.Lease lease = traffic.acquireStream(address);
    try {
      return new PublicShareContent(
          storage.read(sharing.authorizePublicContentAndRecordAccess(token)), lease);
    } catch (IOException | RuntimeException ex) {
      lease.close();
      throw ex;
    }
  }
}
