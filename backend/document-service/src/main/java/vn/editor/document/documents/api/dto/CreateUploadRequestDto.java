package vn.editor.document.documents.api.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import java.util.Map;
import vn.editor.document.documents.application.command.CreateUploadCommand;
import vn.editor.document.documents.domain.UploadPolicy;
import vn.editor.document.shared.domain.DomainException;
import vn.editor.document.shared.domain.Values;

public record CreateUploadRequestDto(
    long expectedHeadRevision, long nativeBytes, String nativeSha256) {
  @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
  public static CreateUploadRequestDto from(Map<String, Object> body) {
    Values.fields(body, "expectedHeadRevision,nativeBytes,nativeSha256", "");
    if (!(body.get("nativeSha256") instanceof String hash)) {
      throw new DomainException(400, "INVALID_REQUEST");
    }
    return new CreateUploadRequestDto(
        Values.integer(body.get("expectedHeadRevision"), 0, Values.MAX_SAFE_INTEGER),
        Values.integer(
            body.get("nativeBytes"), UploadPolicy.MIN_NATIVE_BYTES, UploadPolicy.MAX_NATIVE_BYTES),
        hash);
  }

  public CreateUploadCommand command(String actor, String id) {
    return new CreateUploadCommand(actor, id, expectedHeadRevision, nativeBytes, nativeSha256);
  }
}
