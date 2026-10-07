package vn.editor.document.documents.application.port;

import java.util.List;
import vn.editor.document.documents.application.port.SnapshotStore.ObjectReference;

public interface RetentionRepository {
  record Orphan(String uploadId, String session, String key, ObjectReference reference) {}

  record Retired(String versionId, ObjectReference reference) {}

  List<Orphan> expiredOrphans();

  void orphanDeleted(String uploadId);

  List<String> retiredCandidates();

  Retired claimRetired(String versionId);

  void retiredDeleted(String versionId);

  void purgeTrash();

  void expireReceipts();
}
