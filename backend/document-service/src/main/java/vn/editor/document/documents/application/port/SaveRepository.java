package vn.editor.document.documents.application.port;

import java.time.Instant;
import vn.editor.document.documents.application.command.CreateUploadCommand;
import vn.editor.document.documents.application.command.SaveDocumentCommand;
import vn.editor.document.documents.application.command.SaveResult;
import vn.editor.document.documents.domain.UploadTicket;
import vn.editor.document.documents.domain.ValidatedSnapshot;

public interface SaveRepository {
  void reserve(
      CreateUploadCommand command,
      String uploadId,
      String key,
      String provider,
      String bucket,
      Instant expiry);

  void abandon(String uploadId);

  void registerResumable(String uploadId, String uri);

  void authorizeWrite(String actor, String documentId);

  UploadTicket ticket(String actor, String uploadId);

  void markUploaded(String uploadId, String generation);

  SaveResult prior(SaveDocumentCommand command, String fingerprint);

  UploadTicket claim(SaveDocumentCommand command, String lease);

  void validated(String uploadId, String lease, ValidatedSnapshot snapshot, String generation);

  void releaseValidation(String uploadId, String lease);

  SaveResult finish(
      SaveDocumentCommand command,
      String fingerprint,
      String lease,
      ValidatedSnapshot snapshot,
      SnapshotStore.Metadata metadata);
}
