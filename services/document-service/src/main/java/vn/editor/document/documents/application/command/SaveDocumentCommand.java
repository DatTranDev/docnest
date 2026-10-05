package vn.editor.document.documents.application.command;

import java.util.Map;
import vn.editor.document.shared.domain.Values;

public record SaveDocumentCommand(
    String actor,
    String documentId,
    String idempotencyKey,
    String uploadId,
    long expectedHeadRevision) {
  public SaveDocumentCommand {
    actor = Values.id(actor);
    documentId = Values.id(documentId);
    idempotencyKey = Values.id(idempotencyKey);
    uploadId = Values.id(uploadId);
    Values.integer(expectedHeadRevision, 0, Values.MAX_SAFE_INTEGER);
  }

  public static SaveDocumentCommand from(
      String actor, String id, String key, Map<String, Object> body) {
    Values.fields(body, "uploadId,expectedHeadRevision", "");
    return new SaveDocumentCommand(
        actor,
        id,
        key,
        Values.id(body.get("uploadId")),
        Values.integer(body.get("expectedHeadRevision"), 0, Values.MAX_SAFE_INTEGER));
  }
}
