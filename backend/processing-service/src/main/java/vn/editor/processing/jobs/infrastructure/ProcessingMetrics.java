package vn.editor.processing.jobs.infrastructure;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
class ProcessingMetrics {
  ProcessingMetrics(JdbcTemplate db, MeterRegistry metrics) {
    Gauge.builder(
            "editor.outbox.pending",
            db,
            d -> number(d, "SELECT COUNT(*) FROM outbox_events WHERE published_at IS NULL"))
        .register(metrics);
    Gauge.builder(
            "editor.outbox.oldest.pending.seconds",
            db,
            d ->
                number(
                    d,
                    "SELECT COALESCE(MAX(TIMESTAMPDIFF(SECOND,created_at,UTC_TIMESTAMP(6))),0) FROM outbox_events WHERE published_at IS NULL"))
        .register(metrics);
    Gauge.builder(
            "editor.jobs.queue.age.seconds",
            db,
            d ->
                number(
                    d,
                    "SELECT COALESCE(MAX(TIMESTAMPDIFF(SECOND,created_at,UTC_TIMESTAMP(6))),0) FROM jobs WHERE state IN ('QUEUED','READY')"))
        .register(metrics);
  }

  private static double number(JdbcTemplate db, String sql) {
    try {
      Number n = db.queryForObject(sql, Number.class);
      return n == null ? 0 : n.doubleValue();
    } catch (RuntimeException e) {
      return Double.NaN;
    }
  }
}
