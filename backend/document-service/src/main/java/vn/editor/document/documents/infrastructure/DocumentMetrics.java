package vn.editor.document.documents.infrastructure;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.binder.MeterBinder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

@Configuration
public class DocumentMetrics {
  @Bean
  MeterBinder documentMeters(JdbcTemplate database, NativeSnapshotValidator validator) {
    return registry -> {
      Gauge.builder(
              "editor.outbox.pending",
              database,
              db -> {
                try {
                  return db.queryForObject(
                      "SELECT COUNT(*) FROM outbox_events WHERE published_at IS NULL",
                      Double.class);
                } catch (RuntimeException ex) {
                  return Double.NaN;
                }
              })
          .description("SQL outbox records awaiting broker ACK")
          .register(registry);
      Gauge.builder(
              "editor.outbox.oldest.pending.seconds",
              database,
              db -> {
                try {
                  return db.queryForObject(
                      "SELECT COALESCE(TIMESTAMPDIFF(SECOND,MIN(created_at),UTC_TIMESTAMP(6)),0)"
                          + " FROM outbox_events WHERE published_at IS NULL",
                      Double.class);
                } catch (RuntimeException ex) {
                  return Double.NaN;
                }
              })
          .description("Age of oldest durable unpublished event")
          .register(registry);
      Gauge.builder("editor.native.validation.active", validator, NativeSnapshotValidator::active)
          .description("Active bounded native validators")
          .register(registry);
    };
  }
}
