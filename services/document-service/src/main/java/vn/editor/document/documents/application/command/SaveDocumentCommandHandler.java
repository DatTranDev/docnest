package vn.editor.document.documents.application.command;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.UUID;
import vn.editor.document.documents.application.port.SaveRepository;
import vn.editor.document.documents.application.port.SnapshotValidator;
import vn.editor.document.documents.domain.UploadTicket;

/**
 * The validator performs storage I/O only after the repository has committed its short lease
 * transaction.
 */
public final class SaveDocumentCommandHandler {
  private final SaveRepository saves;
  private final SnapshotValidator validator;

  public SaveDocumentCommandHandler(SaveRepository saves, SnapshotValidator validator) {
    this.saves = saves;
    this.validator = validator;
  }

  public SaveResult handle(SaveDocumentCommand command) throws IOException {
    String fingerprint = fingerprint(command);
    SaveResult prior = saves.prior(command, fingerprint);
    if (prior != null) return prior;
    String lease = UUID.randomUUID().toString();
    UploadTicket ticket = saves.claim(command, lease);
    SnapshotValidator.Result result;
    try {
      result = validator.validate(ticket);
      saves.validated(
          command.uploadId(), lease, result.snapshot(), result.metadata().ref().generation());
    } catch (IOException | RuntimeException ex) {
      saves.releaseValidation(command.uploadId(), lease);
      throw ex;
    }
    return saves.finish(command, fingerprint, lease, result.snapshot(), result.metadata());
  }

  private static String fingerprint(SaveDocumentCommand command) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256")
                  .digest(
                      (command.documentId()
                              + ":"
                              + command.uploadId()
                              + ":"
                              + command.expectedHeadRevision())
                          .getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException ex) {
      throw new IllegalStateException(ex);
    }
  }
}
