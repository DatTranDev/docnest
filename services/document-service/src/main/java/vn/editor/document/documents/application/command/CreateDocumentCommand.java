package vn.editor.document.documents.application.command;

import java.util.Map;
import vn.editor.document.shared.domain.Values;

public record CreateDocumentCommand(String actor, String title, String folderId) {
  public CreateDocumentCommand {
    actor = Values.id(actor);
    title = Values.name(title, 200);
    folderId = Values.nullableId(folderId);
  }

  public static CreateDocumentCommand from(String actor, Map<String, Object> body) {
    Values.fields(body, "title,folderId", "");
    return new CreateDocumentCommand(
        actor, Values.name(body.get("title"), 200), Values.nullableId(body.get("folderId")));
  }
}
