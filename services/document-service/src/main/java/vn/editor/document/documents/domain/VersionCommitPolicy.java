package vn.editor.document.documents.domain;

import vn.editor.document.shared.domain.DomainException;
import vn.editor.document.shared.domain.Values;

public final class VersionCommitPolicy {
  private VersionCommitPolicy() {}

  public static void requireExpectedHead(long head, long expected) {
    if (head != expected)
      throw new DomainException(409, "REVISION_CONFLICT", Values.map("currentHeadRevision", head));
  }

  public static boolean unchanged(String headHash, String snapshotHash) {
    return headHash != null && headHash.equals(snapshotHash);
  }
}
