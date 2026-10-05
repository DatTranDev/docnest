package vn.editor.processing.jobs.application.port;

import java.util.List;
import vn.editor.common.storage.StorageProvider;

/** Bounded cleanup intent and reference bookkeeping; generation deletion happens outside SQL. */
public interface JobOutputCleanupRepository {
  record ExpiredResult(String jobId, StorageProvider.ObjectRef reference) {}

  record OrphanAttempt(String attemptId, String outputKey) {}

  List<ExpiredResult> expiredResults();

  void clearExpiredResult(String jobId);

  List<OrphanAttempt> orphanCandidates();

  boolean isOutputReferenced(String key);

  void markAttemptCleaned(String attemptId);

  void retainRecentBookkeeping();
}
