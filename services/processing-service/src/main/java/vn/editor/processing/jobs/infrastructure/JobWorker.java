package vn.editor.processing.jobs.infrastructure;

import jakarta.annotation.PreDestroy;
import java.io.Closeable;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.FutureTask;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vn.editor.common.codec.NativeCodec;
import vn.editor.common.observability.OperationalMetrics;
import vn.editor.common.observability.SafeLog;
import vn.editor.common.observability.TraceContext;
import vn.editor.common.storage.StorageProvider;
import vn.editor.processing.jobs.application.port.JobExecutionRepository;
import vn.editor.processing.jobs.application.port.JobExecutionRepository.LeasedJob;
import vn.editor.processing.jobs.application.port.JobOutputCleanupRepository;
import vn.editor.processing.jobs.domain.JobLifecyclePolicy;

/** Executes bounded storage/render IO; durable mutations and cleanup queries belong to ports. */
@Component
@ConditionalOnProperty(
    name = "editor.processing.enabled",
    havingValue = "true",
    matchIfMissing = true)
public class JobWorker {
  private static final int WORKER_CONCURRENCY = 2;
  private static final int ATTEMPT_DEADLINE_SECONDS = 120;
  private static final int COPY_BUFFER_BYTES = 65536;
  private final JobExecutionRepository execution;
  private final JobOutputCleanupRepository cleanup;
  private final StorageProvider storage;
  private final ExecutorService pool = Executors.newFixedThreadPool(WORKER_CONCURRENCY);
  private final Map<String, String> active = new ConcurrentHashMap<>();
  private final Map<String, Instant> started = new ConcurrentHashMap<>();
  private final Map<String, FutureTask<Void>> tasks = new ConcurrentHashMap<>();
  private final Map<String, Closeable> io = new ConcurrentHashMap<>();

  JobWorker(
      JobExecutionRepository execution,
      JobOutputCleanupRepository cleanup,
      StorageProvider storage) {
    this.execution = execution;
    this.cleanup = cleanup;
    this.storage = storage;
  }

  @Scheduled(fixedDelay = 1000)
  void schedule() {
    expire();
    while (active.size() < WORKER_CONCURRENCY) {
      LeasedJob job = execution.claim(active.keySet());
      if (job == null) break;
      String id = job.id(), owner = job.leaseOwner();
      active.put(id, owner);
      started.put(id, Instant.now());
      FutureTask<Void> task =
          new FutureTask<>(
              () -> {
                try {
                  run(job);
                } finally {
                  active.remove(id, owner);
                  started.remove(id);
                  tasks.remove(id);
                  io.remove(id);
                }
              },
              null);
      tasks.put(id, task);
      pool.execute(task);
    }
  }

  @Scheduled(fixedDelay = 15000)
  void heartbeat() {
    for (var entry : active.entrySet()) {
      execution.heartbeat(entry.getKey(), entry.getValue());
    }
  }

  /** Compatibility seam used by the existing real-service lease/concurrency tests. */
  public Map<String, Object> claim() {
    LeasedJob job = execution.claim(active.keySet());
    return job == null ? null : Map.of("id", job.id(), "lease_owner", job.leaseOwner());
  }

  @Scheduled(fixedDelay = 1000)
  void attemptWatchdog() {
    for (var entry : started.entrySet()) {
      if (Duration.between(entry.getValue(), Instant.now()).getSeconds()
          >= ATTEMPT_DEADLINE_SECONDS) {
        timeoutAttempt(entry.getKey(), active.get(entry.getKey()));
      }
    }
  }

  void timeoutAttempt(String id, String owner) {
    if (owner == null) return;
    fail(id, owner, "ATTEMPT_DEADLINE", true, false);
    FutureTask<Void> task = tasks.get(id);
    if (task != null) task.cancel(true);
    Closeable stream = io.remove(id);
    if (stream != null) {
      try {
        stream.close();
      } catch (IOException ignored) {
      }
    }
  }

  void expire() {
    execution.expire();
  }

  private void run(LeasedJob job) {
    Path source = null, result = null;
    String id = job.id(), owner = job.leaseOwner();
    Instant start = Instant.now();
    long startedNanos = System.nanoTime();
    Runnable check = () -> check(job, start);
    try (TraceContext.Scope scope = TraceContext.open(job.traceId(), null)) {
      check.run();
      source = Files.createTempFile("editor-source-", ".tedoc");
      try (InputStream in = storage.read(job.source());
          OutputStream out = Files.newOutputStream(source)) {
        io.put(id, in);
        byte[] buffer = new byte[COPY_BUFFER_BYTES];
        long count = 0;
        for (int n; (n = in.read(buffer)) != -1; ) {
          check.run();
          count += n;
          if (count > NativeCodec.MAX_NATIVE) throw new NativeCodec.InvalidNative("FILE_TOO_LARGE");
          out.write(buffer, 0, n);
        }
      } finally {
        io.remove(id);
      }
      NativeCodec.Decoded decoded = NativeCodec.decode(source);
      if (!decoded.nativeSha256().equals(job.sourceNativeSha256())) {
        throw new NativeCodec.InvalidNative("INVALID_NATIVE_FILE");
      }
      check.run();
      if (job.type().equals("PREVIEW")) {
        finish(id, owner, null, 0, ExportRenderer.preview(decoded.text()));
        return;
      }
      result = Files.createTempFile("editor-export-", ".tmp");
      try (OutputStream out =
          new ExportRenderer.CappedOutput(
              Files.newOutputStream(result), ExportRenderer.MAX_OUTPUT)) {
        if (job.type().equals("EXPORT_TXT")) ExportRenderer.txt(decoded, out, check);
        else ExportRenderer.html(decoded, out, check);
      }
      check.run();
      String extension = job.type().equals("EXPORT_TXT") ? "txt" : "html";
      String outputKey = "results/" + id + "/" + owner + "." + extension;
      execution.reserveOutput(id, owner, outputKey);
      StorageProvider.Metadata output;
      try (InputStream in = Files.newInputStream(result)) {
        output = storage.writeNew(outputKey, in, Files.size(result), ExportRenderer.MAX_OUTPUT);
      }
      check.run();
      if (!finish(id, owner, output.ref(), output.bytes(), null)) {
        storage.deleteGeneration(output.ref());
      }
    } catch (LostLease exception) {
      /* Another lease holder owns completion. Its result must remain untouched. */
    } catch (Cancelled exception) {
      fail(id, owner, "CANCELLED", false, true);
    } catch (AttemptDeadline exception) {
      fail(id, owner, "ATTEMPT_DEADLINE", true, false);
    } catch (NativeCodec.InvalidNative exception) {
      fail(id, owner, exception.code, false, false);
    } catch (ExportRenderer.OutputTooLarge exception) {
      fail(id, owner, "EXPORT_TOO_LARGE", false, false);
    } catch (Exception exception) {
      fail(id, owner, "STORAGE_IO", true, false);
    } finally {
      OperationalMetrics.jobDuration("processing-service", System.nanoTime() - startedNanos);
      try (TraceContext.Scope scope = TraceContext.open(job.traceId(), null)) {
        SafeLog.record(
            "processing-service",
            SafeLog.Action.JOB_ATTEMPT_FINISHED,
            job.documentId(),
            id,
            null,
            job.revision(),
            (System.nanoTime() - startedNanos) / 1000000,
            0);
      }
      deleteTemp(source);
      deleteTemp(result);
    }
  }

  private void check(LeasedJob job, Instant start) {
    if (Duration.between(start, Instant.now()).getSeconds() >= ATTEMPT_DEADLINE_SECONDS) {
      throw new AttemptDeadline();
    }
    JobExecutionRepository.ExecutionState current = execution.current(job.id());
    if (!JobLifecyclePolicy.ownsLiveLease(
        current.state(),
        job.leaseOwner(),
        current.leaseOwner(),
        current.leaseUntil(),
        Instant.now())) {
      throw new LostLease();
    }
    if (current.cancelRequested()) throw new Cancelled();
    if (!current.deadline().isAfter(Instant.now())) throw new AttemptDeadline();
  }

  public boolean finish(
      String id,
      String owner,
      StorageProvider.ObjectRef output,
      long bytes,
      Map<String, Object> summary) {
    return execution.complete(id, owner, output, bytes, summary);
  }

  void fail(String id, String owner, String code, boolean transientFailure, boolean cancelled) {
    execution.fail(id, owner, code, transientFailure, cancelled);
  }

  @Scheduled(fixedDelay = 60000)
  void gc() {
    for (JobOutputCleanupRepository.ExpiredResult result : cleanup.expiredResults()) {
      try {
        storage.deleteGeneration(result.reference());
        cleanup.clearExpiredResult(result.jobId());
      } catch (IOException exception) {
        /* Keep pointer until a generation-aware delete succeeds. */
      }
    }
  }

  @Scheduled(fixedDelay = 60000)
  void orphanGc() {
    for (JobOutputCleanupRepository.OrphanAttempt attempt : cleanup.orphanCandidates()) {
      if (cleanup.isOutputReferenced(attempt.outputKey())) continue;
      try {
        StorageProvider.Metadata metadata = storage.inspect(attempt.outputKey());
        storage.deleteGeneration(metadata.ref());
        cleanup.markAttemptCleaned(attempt.attemptId());
      } catch (FileNotFoundException | NoSuchFileException exception) {
        cleanup.markAttemptCleaned(attempt.attemptId());
      } catch (IOException exception) {
        /* Preserve durable cleanup intent across storage outages. */
      }
    }
  }

  @Scheduled(fixedDelay = 60000)
  void retention() {
    cleanup.retainRecentBookkeeping();
  }

  private void deleteTemp(Path path) {
    if (path != null) {
      try {
        Files.deleteIfExists(path);
      } catch (IOException ignored) {
      }
    }
  }

  @PreDestroy
  void shutdown() {
    pool.shutdownNow();
  }

  private static class LostLease extends RuntimeException {}

  private static class Cancelled extends RuntimeException {}

  private static class AttemptDeadline extends RuntimeException {}
}
