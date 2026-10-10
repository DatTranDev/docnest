package vn.editor.document.documents.api.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import java.util.Map;
import vn.editor.document.documents.application.command.ChangeDocumentMetadataCommand;
import vn.editor.document.shared.domain.Values;

public record ChangeDocumentMetadataRequestDto(
    long expectedMetadataRevision, String title, boolean folderChanged, String folderId) {
  @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
  public static ChangeDocumentMetadataRequestDto from(Map<String, Object> body) {
    Values.fields(body, "expectedMetadataRevision", "title,folderId");
    return new ChangeDocumentMetadataRequestDto(
        Values.integer(body.get("expectedMetadataRevision"), 1, Values.MAX_SAFE_INTEGER),
        body.containsKey("title") ? Values.name(body.get("title"), 200) : null,
        body.containsKey("folderId"),
        Values.nullableId(body.get("folderId")));
  }

  public ChangeDocumentMetadataCommand command(String actor, String id) {
    return new ChangeDocumentMetadataCommand(
        actor, id, expectedMetadataRevision, title, folderChanged, folderId);
  }
}
