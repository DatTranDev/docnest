package vn.editor.document.documents.infrastructure;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;
import vn.editor.common.messaging.EventSchemas;
import vn.editor.common.observability.SafeLog;
import vn.editor.common.observability.TraceContext;
import vn.editor.document.documents.application.port.EventPublisher;

@Component
public final class KafkaEventPublisher implements EventPublisher {
  private final KafkaTemplate<String, String> kafka;

  public KafkaEventPublisher(KafkaTemplate<String, String> kafka) {
    this.kafka = kafka;
  }

  @Override
  public void publish(String topic, String key, String payload) throws Exception {
    if (!EventSchemas.valid(topic, payload))
      throw new IllegalArgumentException("INVALID_EVENT_SCHEMA");
    Map<String, Object> envelope = new ObjectMapper().readValue(payload, Map.class);
    try (TraceContext.Scope scope = TraceContext.open((String) envelope.get("traceId"), null)) {
      kafka.send(topic, key, payload).get(10, TimeUnit.SECONDS);
      SafeLog.record(
          "document-service",
          SafeLog.Action.EVENT_PUBLISHED,
          key,
          null,
          (String) envelope.get("eventId"),
          null,
          0,
          200);
    }
  }
}
