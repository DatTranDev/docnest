package vn.editor.document.documents.api.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import java.util.Map;
import vn.editor.document.documents.application.command.CreateDocumentCommand;
import vn.editor.document.shared.domain.Values;

public record CreateDocumentRequestDto(String title, String folderId) {
  @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
  public static CreateDocumentRequestDto from(Map<String, Object> body) {
    Values.fields(body, "title,folderId", "");
    return new CreateDocumentRequestDto(
        Values.name(body.get("title"), 200), Values.nullableId(body.get("folderId")));
  }

  public CreateDocumentCommand command(String actor) {
    return new CreateDocumentCommand(actor, title, folderId);
  }
}
