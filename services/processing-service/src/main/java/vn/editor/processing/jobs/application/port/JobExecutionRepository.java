package vn.editor.processing.jobs.application.port;

import java.time.Instant;
import java.util.Map;
import java.util.Set;
import vn.editor.common.storage.StorageProvider;

/** Durable lease and completion operations; implementations perform no storage or network IO. */
public interface JobExecutionRepository {
  record LeasedJob(
      String id,
      String documentId,
      long revision,
      String type,
      String leaseOwner,
      StorageProvider.ObjectRef source,
      String sourceNativeSha256,
      String traceId) {}

  record ExecutionState(
      String state,
      String leaseOwner,
      Instant leaseUntil,
      boolean cancelRequested,
      Instant deadline) {}

  LeasedJob claim(Set<String> locallyActiveIds);

  ExecutionState current(String id);

  void heartbeat(String id, String owner);

  void reserveOutput(String id, String owner, String outputKey);

  boolean complete(
      String id,
      String owner,
      StorageProvider.ObjectRef output,
      long bytes,
      Map<String, Object> summary);

  void fail(String id, String owner, String code, boolean transientFailure, boolean cancelled);

  void expire();
}
