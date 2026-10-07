package vn.editor.document.documents.application.command;

import java.util.Map;
import vn.editor.document.shared.domain.DomainException;
import vn.editor.document.shared.domain.Values;

public record ChangeDocumentMetadataCommand(
    String actor,
    String documentId,
    long expectedMetadataRevision,
    String title,
    boolean folderChanged,
    String folderId) {
  public ChangeDocumentMetadataCommand {
    actor = Values.id(actor);
    documentId = Values.id(documentId);
    Values.integer(expectedMetadataRevision, 1, Values.MAX_SAFE_INTEGER);
    if (title != null) title = Values.name(title, 200);
    folderId = Values.nullableId(folderId);
    if (title == null && !folderChanged) throw new DomainException(400, "INVALID_REQUEST");
  }

  public static ChangeDocumentMetadataCommand from(
      String actor, String id, Map<String, Object> body) {
    Values.fields(body, "expectedMetadataRevision", "title,folderId");
    return new ChangeDocumentMetadataCommand(
        actor,
        id,
        Values.integer(body.get("expectedMetadataRevision"), 1, Values.MAX_SAFE_INTEGER),
        body.containsKey("title") ? Values.name(body.get("title"), 200) : null,
        body.containsKey("folderId"),
        Values.nullableId(body.get("folderId")));
  }
}
