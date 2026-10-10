package vn.editor.processing.jobs.infrastructure;

import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import vn.editor.common.observability.OperationalMetrics;
import vn.editor.common.observability.SafeLog;
import vn.editor.common.observability.TraceContext;

@Component
class KafkaWorkflow {
  private final JdbcJobDao jobs;
  private final ProcessingEvents events;
  private final KafkaTemplate<String, String> kafka;
  private final JdbcTemplate db;
  private final TransactionTemplate tx;

  KafkaWorkflow(
      JdbcJobDao jobs,
      ProcessingEvents events,
      KafkaTemplate<String, String> kafka,
      JdbcTemplate db,
      TransactionTemplate tx) {
    this.jobs = jobs;
    this.events = events;
    this.kafka = kafka;
    this.db = db;
    this.tx = tx;
  }

  @KafkaListener(topics = "document.version.saved.v1", groupId = "processing-preview-v1")
  void preview(ConsumerRecord<String, String> record, Acknowledgment ack) throws Exception {
    consume(record, ack, true);
  }

  @KafkaListener(topics = "processing.job.requested.v1", groupId = "processing-dispatch-v1")
  void requested(ConsumerRecord<String, String> record, Acknowledgment ack) throws Exception {
    consume(record, ack, false);
  }

  private void consume(ConsumerRecord<String, String> r, Acknowledgment ack, boolean preview)
      throws Exception {
    Map<String, Object> event;
    try {
      event = events.parse(r.topic(), r.value());
    } catch (IllegalArgumentException e) {
      SafeLog.invalidEvent("processing-service", r.value(), r.partition(), r.offset());
      deadLetter(r, true);
      ack.acknowledge();
      return;
    }
    try (TraceContext.Scope scope = TraceContext.open((String) event.get("traceId"), null)) {
      for (int attempt = 0; attempt < 4; attempt++) {
        try {
          if (preview) jobs.documentSaved(event);
          else jobs.requested(event);
          Map<String, Object> p = (Map<String, Object>) event.get("payload");
          SafeLog.record(
              "processing-service",
              SafeLog.Action.EVENT_CONSUMED,
              (String) p.get("documentId"),
              (String) p.get("jobId"),
              (String) event.get("eventId"),
              ((Number) p.get("revision")).longValue(),
              0,
              200);
          ack.acknowledge();
          return;
        } catch (RuntimeException e) {
          if (attempt == 3) {
            deadLetter(r, false);
            ack.acknowledge();
            return;
          }
          Thread.sleep(new long[] {1000, 5000, 30000}[attempt]);
        }
      }
    }
  }

  private void deadLetter(ConsumerRecord<String, String> r, boolean redact) throws Exception {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("originalTopic", r.topic());
    p.put("partition", r.partition());
    p.put("offset", r.offset());
    p.put("originalKey", redact ? null : r.key());
    p.put(
        "originalPayloadBase64",
        redact
            ? ""
            : Base64.getEncoder()
                .encodeToString(r.value().getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    p.put("reason", redact ? "INVALID_SCHEMA_REDACTED" : "DATABASE_RETRIES_EXHAUSTED");
    String raw = events.encode(events.envelope("ConsumerDeadLetter", p));
    events.parse("editor.dead-letter.v1", raw);
    try {
      kafka.send("editor.dead-letter.v1", redact ? null : r.key(), raw).get(10, TimeUnit.SECONDS);
      OperationalMetrics.increment("processing-service", OperationalMetrics.Counter.DLQ_COUNT);
      SafeLog.record(
          "processing-service", SafeLog.Action.DLQ_PUBLISHED, null, null, null, null, 0, 200);
    } catch (Exception e) {
      throw new org.springframework.kafka.KafkaException("DLQ_UNAVAILABLE");
    }
  }

  @Scheduled(fixedDelay = 1000)
  void relay() {
    for (int i = 0; i < 100; i++) {
      Map<String, Object> row =
          tx.execute(
              t -> {
                List<Map<String, Object>> rows =
                    db.queryForList(
                        "SELECT * FROM outbox_events WHERE published_at IS NULL AND next_attempt_at<=UTC_TIMESTAMP(6) AND (lease_until IS NULL OR lease_until<UTC_TIMESTAMP(6)) ORDER BY id LIMIT 1 FOR UPDATE");
                if (rows.isEmpty()) return null;
                var r = rows.getFirst();
                String owner = UUID.randomUUID().toString();
                db.update(
                    "UPDATE outbox_events SET lease_owner=?,lease_until=UTC_TIMESTAMP(6)+INTERVAL 30 SECOND,attempts=attempts+1 WHERE id=?",
                    owner,
                    r.get("id"));
                r.put("lease_owner", owner);
                return r;
              });
      if (row == null) return;
      try {
        String topic = (String) row.get("topic");
        String raw =
            row.get("payload") instanceof byte[] b
                ? new String(b, java.nio.charset.StandardCharsets.UTF_8)
                : row.get("payload").toString();
        Map<String, Object> event = events.parse(topic, raw);
        try (TraceContext.Scope scope = TraceContext.open((String) event.get("traceId"), null)) {
          kafka.send(topic, (String) row.get("event_key"), raw).get(10, TimeUnit.SECONDS);
          SafeLog.record(
              "processing-service",
              SafeLog.Action.EVENT_PUBLISHED,
              (String) row.get("aggregate_id"),
              null,
              (String) event.get("eventId"),
              ((Number) row.get("aggregate_revision")).longValue(),
              0,
              200);
        }
        db.update(
            "UPDATE outbox_events SET published_at=UTC_TIMESTAMP(6),lease_owner=NULL,lease_until=NULL,last_error_code=NULL WHERE id=? AND lease_owner=?",
            row.get("id"),
            row.get("lease_owner"));
      } catch (Exception e) {
        int attempts = ((Number) row.get("attempts")).intValue() + 1;
        int delay = attempts <= 1 ? 1 : attempts == 2 ? 5 : attempts == 3 ? 30 : 60;
        db.update(
            "UPDATE outbox_events SET next_attempt_at=UTC_TIMESTAMP(6)+INTERVAL ? SECOND,lease_owner=NULL,lease_until=NULL,last_error_code='BROKER_OR_SCHEMA' WHERE id=? AND lease_owner=?",
            delay,
            row.get("id"),
            row.get("lease_owner"));
        return;
      }
    }
  }
}
