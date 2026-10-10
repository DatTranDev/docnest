package vn.editor.document.folders.api.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import java.util.Map;
import vn.editor.document.folders.application.command.MoveFolderCommand;
import vn.editor.document.shared.domain.Values;

public record MoveFolderRequestDto(
    long expectedMetadataRevision, String name, boolean parentChanged, String parentId) {
  @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
  public static MoveFolderRequestDto from(Map<String, Object> body) {
    Values.fields(body, "expectedMetadataRevision", "name,parentId");
    return new MoveFolderRequestDto(
        Values.integer(body.get("expectedMetadataRevision"), 1, Values.MAX_SAFE_INTEGER),
        body.containsKey("name") ? Values.name(body.get("name"), 120) : null,
        body.containsKey("parentId"),
        Values.nullableId(body.get("parentId")));
  }

  public MoveFolderCommand command(String actor, String id) {
    return new MoveFolderCommand(
        actor, id, expectedMetadataRevision, name, parentChanged, parentId);
  }
}
