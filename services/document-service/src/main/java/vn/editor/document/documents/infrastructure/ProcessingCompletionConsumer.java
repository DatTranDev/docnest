package vn.editor.document.documents.infrastructure;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;
import vn.editor.common.messaging.EventSchemas;
import vn.editor.common.observability.OperationalMetrics;
import vn.editor.common.observability.SafeLog;
import vn.editor.common.observability.TraceContext;
import vn.editor.document.documents.application.command.ApplyPreviewCompletionCommand;
import vn.editor.document.documents.application.command.ApplyPreviewCompletionHandler;
import vn.editor.document.shared.domain.Values;

@Component
public final class ProcessingCompletionConsumer {
  private final ObjectMapper json = new ObjectMapper();
  private final KafkaTemplate<String, String> kafka;
  private final ApplyPreviewCompletionHandler projection;

  public ProcessingCompletionConsumer(
      KafkaTemplate<String, String> kafka, ApplyPreviewCompletionHandler projection) {
    this.kafka = kafka;
    this.projection = projection;
  }

  @KafkaListener(topics = "processing.job.completed.v1", groupId = "document-preview-projection-v1")
  public void completed(ConsumerRecord<String, String> record, Acknowledgment ack)
      throws Exception {
    if (!EventSchemas.valid(record.topic(), record.value())) {
      SafeLog.invalidEvent("document-service", record.value(), record.partition(), record.offset());
      deadLetter(record, true);
      ack.acknowledge();
      return;
    }
    Map<String, Object> envelope = json.readValue(record.value(), Map.class);
    try (TraceContext.Scope scope = TraceContext.open((String) envelope.get("traceId"), null)) {
      for (int attempt = 0; attempt < 4; attempt++) {
        try {
          applyCompletion(envelope);
          Map<String, Object> payload = (Map<String, Object>) envelope.get("payload");
          SafeLog.record(
              "document-service",
              SafeLog.Action.EVENT_CONSUMED,
              (String) payload.get("documentId"),
              (String) payload.get("jobId"),
              (String) envelope.get("eventId"),
              ((Number) payload.get("revision")).longValue(),
              0,
              200);
          ack.acknowledge();
          return;
        } catch (RuntimeException ex) {
          if (attempt == 3) {
            deadLetter(record, false);
            ack.acknowledge();
            return;
          }
          Thread.sleep(new long[] {1000, 5000, 30000}[attempt]);
        }
      }
    }
  }

  void applyCompletion(Map<String, Object> envelope) {
    projection.handle(ApplyPreviewCompletionCommand.from(envelope));
  }

  void deadLetter(ConsumerRecord<String, String> r, boolean redact) throws Exception {
    String event = UUID.randomUUID().toString();
    Map<String, Object> p =
        Values.map(
            "originalTopic",
            r.topic(),
            "partition",
            r.partition(),
            "offset",
            r.offset(),
            "originalKey",
            redact ? null : r.key(),
            "originalPayloadBase64",
            redact
                ? ""
                : Base64.getEncoder().encodeToString(r.value().getBytes(StandardCharsets.UTF_8)),
            "reason",
            redact ? "INVALID_SCHEMA_REDACTED" : "DATABASE_RETRIES_EXHAUSTED");
    String value =
        json.writeValueAsString(
            Values.map(
                "eventId",
                event,
                "eventType",
                "ConsumerDeadLetter",
                "schemaVersion",
                1,
                "occurredAt",
                Instant.now().toString(),
                "producer",
                "consumer-error-handler",
                "traceId",
                TraceContext.traceId(),
                "payload",
                p));
    if (!EventSchemas.valid("editor.dead-letter.v1", value))
      throw new IllegalStateException("INVALID_DLQ");
    kafka.send("editor.dead-letter.v1", redact ? null : r.key(), value).get(10, TimeUnit.SECONDS);
    OperationalMetrics.increment("document-service", OperationalMetrics.Counter.DLQ_COUNT);
    SafeLog.record(
        "document-service", SafeLog.Action.DLQ_PUBLISHED, null, null, event, null, 0, 200);
  }
}
