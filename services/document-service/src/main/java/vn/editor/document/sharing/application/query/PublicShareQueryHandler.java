package vn.editor.document.sharing.application.query;

import java.io.IOException;
import java.io.InputStream;
import vn.editor.document.documents.application.port.SnapshotStore;
import vn.editor.document.sharing.application.port.PublicTrafficLimit;
import vn.editor.document.sharing.application.port.SharingReadPort;

public final class PublicShareQueryHandler {
  public record Content(InputStream input, PublicTrafficLimit.Lease lease) {}

  private final SharingReadPort sharing;
  private final SnapshotStore storage;
  private final PublicTrafficLimit traffic;

  public PublicShareQueryHandler(
      SharingReadPort sharing, SnapshotStore storage, PublicTrafficLimit traffic) {
    this.sharing = sharing;
    this.storage = storage;
    this.traffic = traffic;
  }

  public PublicDocumentView document(String token, String address) {
    traffic.take(address, false);
    return sharing.publicDocument(token);
  }

  public Content content(String token, String address) throws IOException {
    traffic.take(address, true);
    PublicTrafficLimit.Lease lease = traffic.acquireStream(address);
    try {
      return new Content(storage.read(sharing.authorizePublicContentAndRecordAccess(token)), lease);
    } catch (IOException | RuntimeException ex) {
      lease.close();
      throw ex;
    }
  }
}
