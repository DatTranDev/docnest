package vn.editor.document.documents.domain;

import java.time.Instant;
import java.util.Set;
import vn.editor.document.shared.domain.DomainException;

public record UploadTicket(
    String uploadId,
    String documentId,
    String objectKey,
    String provider,
    String bucket,
    String state,
    long expectedHead,
    long expectedBytes,
    String expectedHash,
    Instant expiresAt) {
  public void requireUnexpired(Instant now) {
    if (expiresAt.isBefore(now) || state.equals("ABANDONED"))
      throw new DomainException(410, "UPLOAD_EXPIRED");
  }

  public void requireBinding(String document, long expected) {
    if (!documentId.equals(document) || expectedHead != expected)
      throw new DomainException(400, "INVALID_REQUEST");
  }

  public void requireValidatable() {
    if (state.equals("COMMITTED")) throw new DomainException(409, "UPLOAD_ALREADY_COMMITTED");
  }

  public void requireLocalWrite(long contentLength, Instant now) {
    requireUnexpired(now);
    if (!provider.equals("LOCAL")) throw new DomainException(400, "INVALID_REQUEST");
    if (contentLength != expectedBytes) throw new DomainException(400, "UPLOAD_SIZE_MISMATCH");
    if (!Set.of("CREATED", "UPLOADED").contains(state))
      throw new DomainException(409, "UPLOAD_STATE_CONFLICT");
  }
}
