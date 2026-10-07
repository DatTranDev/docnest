package vn.editor.document.documents.application.command;

import java.util.Map;
import vn.editor.document.documents.domain.UploadPolicy;
import vn.editor.document.shared.domain.DomainException;
import vn.editor.document.shared.domain.Values;

public record CreateUploadCommand(
    String actor,
    String documentId,
    long expectedHeadRevision,
    long nativeBytes,
    String nativeSha256) {
  public CreateUploadCommand {
    actor = Values.id(actor);
    documentId = Values.id(documentId);
    Values.integer(expectedHeadRevision, 0, Values.MAX_SAFE_INTEGER);
    Values.integer(nativeBytes, UploadPolicy.MIN_NATIVE_BYTES, UploadPolicy.MAX_NATIVE_BYTES);
    if (nativeSha256 == null || !nativeSha256.matches("[a-f0-9]{64}"))
      throw new DomainException(400, "INVALID_REQUEST");
  }

  public static CreateUploadCommand from(String actor, String id, Map<String, Object> body) {
    Values.fields(body, "expectedHeadRevision,nativeBytes,nativeSha256", "");
    if (!(body.get("nativeSha256") instanceof String hash))
      throw new DomainException(400, "INVALID_REQUEST");
    return new CreateUploadCommand(
        actor,
        id,
        Values.integer(body.get("expectedHeadRevision"), 0, Values.MAX_SAFE_INTEGER),
        Values.integer(
            body.get("nativeBytes"), UploadPolicy.MIN_NATIVE_BYTES, UploadPolicy.MAX_NATIVE_BYTES),
        hash);
  }
}
