package vn.editor.document.folders.api.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import java.util.Map;
import vn.editor.document.folders.application.command.CreateFolderCommand;
import vn.editor.document.shared.domain.Values;

public record CreateFolderRequestDto(String name, String parentId) {
  @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
  public static CreateFolderRequestDto from(Map<String, Object> body) {
    Values.fields(body, "name,parentId", "");
    return new CreateFolderRequestDto(
        Values.name(body.get("name"), 120), Values.nullableId(body.get("parentId")));
  }

  public CreateFolderCommand command(String actor) {
    return new CreateFolderCommand(actor, name, parentId);
  }
}
