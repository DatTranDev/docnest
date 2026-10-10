package vn.editor.document.sharing.api.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import java.util.Map;
import java.util.Objects;
import vn.editor.document.shared.domain.DomainException;
import vn.editor.document.shared.domain.Values;
import vn.editor.document.sharing.application.command.GrantDocumentAccessByEmailCommand;

public record GrantEmailRequestDto(String email, String role) {
  @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
  public static GrantEmailRequestDto from(Map<String, Object> body) {
    Values.fields(body, "email,role", "");
    if (!(body.get("email") instanceof String email)) {
      throw new DomainException(400, "INVALID_REQUEST");
    }
    return new GrantEmailRequestDto(email, Objects.toString(body.get("role"), ""));
  }

  public GrantDocumentAccessByEmailCommand command(
      String actor, String documentId, String authorization) {
    return new GrantDocumentAccessByEmailCommand(actor, documentId, email, role, authorization);
  }
}
