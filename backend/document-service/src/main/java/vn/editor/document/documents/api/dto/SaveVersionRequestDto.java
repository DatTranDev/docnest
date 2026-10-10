package vn.editor.document.documents.api.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import java.util.Map;
import vn.editor.document.documents.application.command.SaveDocumentCommand;
import vn.editor.document.shared.domain.Values;

public record SaveVersionRequestDto(String uploadId, long expectedHeadRevision) {
  @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
  public static SaveVersionRequestDto from(Map<String, Object> body) {
    Values.fields(body, "uploadId,expectedHeadRevision", "");
    return new SaveVersionRequestDto(
        Values.id(body.get("uploadId")),
        Values.integer(body.get("expectedHeadRevision"), 0, Values.MAX_SAFE_INTEGER));
  }

  public SaveDocumentCommand command(String actor, String id, String key) {
    return new SaveDocumentCommand(actor, id, key, uploadId, expectedHeadRevision);
  }
}
