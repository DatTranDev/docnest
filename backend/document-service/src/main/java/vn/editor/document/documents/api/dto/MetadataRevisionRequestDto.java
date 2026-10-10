package vn.editor.document.documents.api.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import java.util.Map;
import vn.editor.document.documents.application.command.TrashDocumentCommand;
import vn.editor.document.shared.domain.Values;

public record MetadataRevisionRequestDto(long expectedMetadataRevision) {
  @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
  public static MetadataRevisionRequestDto from(Map<String, Object> body) {
    Values.fields(body, "expectedMetadataRevision", "");
    return new MetadataRevisionRequestDto(
        Values.integer(body.get("expectedMetadataRevision"), 1, Values.MAX_SAFE_INTEGER));
  }

  public TrashDocumentCommand command(String actor, String id, boolean restore) {
    return new TrashDocumentCommand(actor, id, expectedMetadataRevision, restore);
  }
}
