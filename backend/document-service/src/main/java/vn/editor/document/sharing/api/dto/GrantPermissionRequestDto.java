package vn.editor.document.sharing.api.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import java.util.Map;
import java.util.Objects;
import vn.editor.document.shared.domain.Values;
import vn.editor.document.sharing.application.command.GrantDocumentAccessCommand;

public record GrantPermissionRequestDto(String role) {
  @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
  public static GrantPermissionRequestDto from(Map<String, Object> body) {
    Values.fields(body, "role", "");
    return new GrantPermissionRequestDto(Objects.toString(body.get("role"), ""));
  }

  public GrantDocumentAccessCommand command(
      String actor, String documentId, String grantee, String authorization) {
    return new GrantDocumentAccessCommand(actor, documentId, grantee, role, authorization);
  }
}
