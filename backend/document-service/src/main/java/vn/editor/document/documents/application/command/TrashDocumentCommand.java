package vn.editor.document.documents.application.command;

import java.util.Map;
import vn.editor.document.shared.domain.Values;

public record TrashDocumentCommand(
    String actor, String documentId, long expectedMetadataRevision, boolean restore) {
  public TrashDocumentCommand {
    actor = Values.id(actor);
    documentId = Values.id(documentId);
    Values.integer(expectedMetadataRevision, 1, Values.MAX_SAFE_INTEGER);
  }

  public static TrashDocumentCommand from(
      String actor, String id, Map<String, Object> body, boolean restore) {
    Values.fields(body, "expectedMetadataRevision", "");
    return new TrashDocumentCommand(
        actor,
        id,
        Values.integer(body.get("expectedMetadataRevision"), 1, Values.MAX_SAFE_INTEGER),
        restore);
  }
}
