package vn.editor.common.observability;

import io.micrometer.core.instrument.Metrics;
import java.util.concurrent.TimeUnit;

/** Fixed metric names and service tags, with no user, document, URL, or token cardinality. */
public final class OperationalMetrics {
  public enum Counter {
    REDIS_FALLBACK,
    DLQ_COUNT,
    LEASE_RECLAIM,
    VALIDATION_FAIL
  }

  public static void increment(String service, Counter counter) {
    Metrics.counter(
            "editor." + counter.name().toLowerCase(java.util.Locale.ROOT).replace('_', '.'),
            "service",
            service)
        .increment();
  }

  public static void jobDuration(String service, long nanos) {
    Metrics.timer("editor.job.duration", "service", service)
        .record(Math.max(0, nanos), TimeUnit.NANOSECONDS);
  }

  public static void snapshotBytes(String service, long bytes) {
    Metrics.summary("editor.snapshot.bytes", "service", service).record(Math.max(0, bytes));
  }

  private OperationalMetrics() {}
}
