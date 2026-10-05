package vn.editor.document.documents.domain;

import java.time.Instant;
import vn.editor.document.shared.domain.DomainException;

public final class RetentionPolicy {
  public static final long TRASH_SECONDS = 14 * 86400L;
  public static final long READ_GRACE_SECONDS = 3600;
  public static final int LIVE_VERSIONS = 20;
  public static final long IDEMPOTENCY_SECONDS = 86400;
  public static final long PUBLISHED_EVENT_SECONDS = 7 * 86400L;

  private RetentionPolicy() {}

  public static void requireRestorable(Instant deletedAt, Instant now) {
    if (deletedAt != null && deletedAt.isBefore(now.minusSeconds(TRASH_SECONDS)))
      throw new DomainException(404, "DOCUMENT_NOT_FOUND");
  }

  public static boolean canDeleteVersion(
      boolean retired,
      boolean alreadyDeleted,
      Instant lastAccess,
      String versionId,
      String headId,
      Instant now) {
    return retired
        && !alreadyDeleted
        && !lastAccess.isAfter(now.minusSeconds(READ_GRACE_SECONDS))
        && !versionId.equals(headId);
  }
}
