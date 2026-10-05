package vn.editor.document.folders.application.command;

import java.util.Map;
import vn.editor.document.shared.domain.DomainException;
import vn.editor.document.shared.domain.Values;

public record MoveFolderCommand(
    String actor,
    String folderId,
    long expectedMetadataRevision,
    String name,
    boolean parentChanged,
    String parentId) {
  public MoveFolderCommand {
    actor = Values.id(actor);
    folderId = Values.id(folderId);
    Values.integer(expectedMetadataRevision, 1, Values.MAX_SAFE_INTEGER);
    if (name != null) name = Values.name(name, 120);
    parentId = Values.nullableId(parentId);
    if (name == null && !parentChanged) throw new DomainException(400, "INVALID_REQUEST");
  }

  public static MoveFolderCommand from(String actor, String id, Map<String, Object> body) {
    Values.fields(body, "expectedMetadataRevision", "name,parentId");
    return new MoveFolderCommand(
        actor,
        id,
        Values.integer(body.get("expectedMetadataRevision"), 1, Values.MAX_SAFE_INTEGER),
        body.containsKey("name") ? Values.name(body.get("name"), 120) : null,
        body.containsKey("parentId"),
        Values.nullableId(body.get("parentId")));
  }
}
