package vn.editor.document.documents.application.command;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.FileAlreadyExistsException;
import java.time.Instant;
import java.util.UUID;
import vn.editor.document.documents.application.port.SaveRepository;
import vn.editor.document.documents.application.port.SnapshotStore;
import vn.editor.document.documents.domain.UploadPolicy;
import vn.editor.document.documents.domain.UploadTicket;
import vn.editor.document.shared.domain.DomainException;

public final class UploadCommandHandler {
  private final SaveRepository saves;
  private final SnapshotStore storage;

  public UploadCommandHandler(SaveRepository saves, SnapshotStore storage) {
    this.saves = saves;
    this.storage = storage;
  }

  public UploadView handle(CreateUploadCommand command) throws IOException {
    String upload = UUID.randomUUID().toString(),
        key = "snapshots/" + command.documentId() + "/" + upload + ".tedoc";
    Instant expiry = Instant.now().plusSeconds(UploadPolicy.TICKET_SECONDS);
    saves.reserve(command, upload, key, storage.provider(), storage.bucket(), expiry);
    SnapshotStore.Upload descriptor;
    try {
      descriptor = storage.createUpload(key, command.nativeBytes(), upload);
    } catch (IOException ex) {
      saves.abandon(upload);
      throw ex;
    }
    if (descriptor.kind().equals("GCS_RESUMABLE"))
      saves.registerResumable(upload, descriptor.url());
    return new UploadView(
        upload,
        descriptor.kind(),
        descriptor.url(),
        "PUT",
        descriptor.headers(),
        expiry.toString());
  }

  public void upload(String actor, String uploadId, long contentLength, InputStream input)
      throws IOException {
    UploadTicket ticket = saves.ticket(actor, uploadId);
    ticket.requireLocalWrite(contentLength, Instant.now());
    saves.authorizeWrite(actor, ticket.documentId());
    SnapshotStore.Metadata object;
    try {
      object =
          storage.writeNew(ticket.objectKey(), input, contentLength, UploadPolicy.MAX_NATIVE_BYTES);
    } catch (FileAlreadyExistsException ex) {
      throw new DomainException(409, "UPLOAD_ALREADY_EXISTS");
    }
    saves.markUploaded(uploadId, object.ref().generation());
  }
}
