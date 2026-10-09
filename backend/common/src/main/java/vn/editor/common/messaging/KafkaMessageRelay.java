package vn.editor.common.messaging;

import java.util.HashMap;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.springframework.kafka.core.KafkaTemplate;
import vn.editor.common.observability.SafeLog;

/** Never publishes while a business SQL transaction is open. */
public final class KafkaMessageRelay {
  private final JdbcMessageLog messages;
  private final KafkaTemplate<String, String> kafka;

  public KafkaMessageRelay(JdbcMessageLog messages, KafkaTemplate<String, String> kafka) {
    this.messages = messages;
    this.kafka = kafka;
  }

  public void relay() {
    for (int count = 0; count < 20; count++) {
      var entries = messages.claim();
      if (entries.isEmpty()) return;
      var entry = entries.getFirst();
      try {
        kafka.send(entry.topic(), entry.key(), entry.payload()).get(10, TimeUnit.SECONDS);
        messages.delivered(entry);
      } catch (InterruptedException interrupted) {
        Thread.currentThread().interrupt();
        messages.retry(entry);
        return;
      } catch (Exception unavailable) {
        // Kafka exceptions can embed payloads/configuration; do not log them.
        messages.retry(entry);
        return;
      }
    }
  }

  public void deadLetter(
      String service,
      String topic,
      String key,
      String raw,
      int partition,
      long offset,
      boolean retainValidated) {
    boolean valid = retainValidated && EventSchemas.valid(topic, raw);
    if (!valid) SafeLog.invalidEvent(service, raw, partition, offset);
    var payload = new HashMap<String, Object>();
    payload.put("originalTopic", topic);
    payload.put("partition", partition);
    payload.put("offset", offset);
    payload.put(
        "originalKey", valid && key != null && key.matches("[a-fA-F0-9-]{36}") ? key : null);
    payload.put(
        "originalPayloadBase64",
        valid
            ? java.util.Base64.getEncoder()
                .encodeToString(raw.getBytes(java.nio.charset.StandardCharsets.UTF_8))
            : "");
    payload.put("reason", valid ? "SAGA_DELIVERY_REQUIRES_REPAIR" : "INVALID_SCHEMA_REDACTED");
    UUID event = UUID.randomUUID();
    String envelope =
        MessageEnvelope.encode(
            event,
            "ConsumerDeadLetter",
            "consumer-error-handler",
            UUID.randomUUID().toString().replace("-", ""),
            payload);
    if (!EventSchemas.valid("editor.dead-letter.v1", envelope))
      throw new IllegalStateException("INVALID_REDACTED_DLQ");
    try {
      kafka.send("editor.dead-letter.v1", event.toString(), envelope).get(10, TimeUnit.SECONDS);
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("DLQ_UNAVAILABLE");
    } catch (Exception unavailable) {
      throw new IllegalStateException("DLQ_UNAVAILABLE");
    }
  }
}
