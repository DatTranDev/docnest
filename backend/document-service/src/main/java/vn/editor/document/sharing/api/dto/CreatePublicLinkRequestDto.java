package vn.editor.document.sharing.api.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import java.util.Map;
import vn.editor.document.shared.domain.Values;
import vn.editor.document.sharing.application.command.CreatePublicLinkCommand;

public record CreatePublicLinkRequestDto(long expiresInSeconds) {
  @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
  public static CreatePublicLinkRequestDto from(Map<String, Object> body) {
    Values.fields(body, "", "expiresInSeconds");
    return new CreatePublicLinkRequestDto(
        body.containsKey("expiresInSeconds")
            ? Values.integer(body.get("expiresInSeconds"), 3600, 2592000)
            : 604800);
  }

  public CreatePublicLinkCommand command(String actor, String documentId) {
    return new CreatePublicLinkCommand(actor, documentId, expiresInSeconds);
  }
}
