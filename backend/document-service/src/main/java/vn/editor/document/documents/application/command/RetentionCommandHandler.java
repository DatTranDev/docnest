package vn.editor.document.documents.application.command;

import java.io.FileNotFoundException;
import java.io.IOException;
import java.nio.file.NoSuchFileException;
import java.time.Instant;
import vn.editor.document.documents.application.port.RetentionRepository;
import vn.editor.document.documents.application.port.SnapshotStore;
import vn.editor.document.documents.domain.RetentionPolicy;

public final class RetentionCommandHandler {
  private final RetentionRepository retention;
  private final SnapshotStore storage;

  public RetentionCommandHandler(RetentionRepository retention, SnapshotStore storage) {
    this.retention = retention;
    this.storage = storage;
  }

  public void collect() {
    try {
      storage.cleanIncompleteBefore(Instant.now().minusSeconds(RetentionPolicy.READ_GRACE_SECONDS));
    } catch (IOException ex) {
      /* Retry incomplete objects in the next scan. */
    }
    expireUploads();
    retiredVersions();
    retention.purgeTrash();
    retention.expireReceipts();
  }

  public void expireUploads() {
    for (RetentionRepository.Orphan orphan : retention.expiredOrphans()) {
      try {
        if (orphan.session() != null) storage.cancelUpload(orphan.session());
        SnapshotStore.ObjectReference ref = orphan.reference();
        if (ref == null) {
          try {
            ref = storage.inspect(orphan.key()).ref();
          } catch (FileNotFoundException | NoSuchFileException ex) {
            retention.orphanDeleted(orphan.uploadId());
            continue;
          }
        }
        storage.deleteGeneration(ref);
        retention.orphanDeleted(orphan.uploadId());
      } catch (IOException ex) {
        /* Generation-pinned deletion is retried from durable SQL state. */
      }
    }
  }

  public void retiredVersions() {
    for (String id : retention.retiredCandidates()) {
      RetentionRepository.Retired retired = retention.claimRetired(id);
      if (retired == null) continue;
      try {
        storage.deleteGeneration(retired.reference());
        retention.retiredDeleted(id);
      } catch (IOException ex) {
        /* Keep the tombstone until object deletion is confirmed. */
      }
    }
  }
}
