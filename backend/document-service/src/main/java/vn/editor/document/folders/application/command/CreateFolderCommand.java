package vn.editor.document.folders.application.command;

import java.util.Map;
import vn.editor.document.shared.domain.Values;

public record CreateFolderCommand(String actor, String name, String parentId) {
  public CreateFolderCommand {
    actor = Values.id(actor);
    name = Values.name(name, 120);
    parentId = Values.nullableId(parentId);
  }

  public static CreateFolderCommand from(String actor, Map<String, Object> body) {
    Values.fields(body, "name,parentId", "");
    return new CreateFolderCommand(
        actor, Values.name(body.get("name"), 120), Values.nullableId(body.get("parentId")));
  }
}
