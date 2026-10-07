package vn.editor.document.documents.domain;

import java.time.Instant;
import vn.editor.document.shared.domain.Values;

public record Document(
    String id,
    String ownerUserId,
    String folderId,
    String restoreFolderId,
    String title,
    long headRevision,
    String headVersionId,
    long metadataRevision,
    Instant deletedAt,
    DocumentAccess access) {
  public void requireMetadataMutation(long expected) {
    access.requireOwner();
    Values.metadataRevision(metadataRevision, expected);
  }

  public Document metadata(long expected, String title, String folder) {
    requireMetadataMutation(expected);
    return new Document(
        id,
        ownerUserId,
        folder,
        restoreFolderId,
        title == null ? this.title : title,
        headRevision,
        headVersionId,
        metadataRevision + 1,
        deletedAt,
        access);
  }

  public void requireRestorable(Instant now) {
    access.requireOwner();
    RetentionPolicy.requireRestorable(deletedAt, now);
  }
}
