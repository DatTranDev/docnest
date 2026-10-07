package vn.editor.processing.jobs.infrastructure;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.networknt.schema.JsonSchema;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.SchemaValidatorsConfig;
import com.networknt.schema.SpecVersion;
import java.time.Instant;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import vn.editor.common.observability.TraceContext;

@Component
public class ProcessingEvents {
  private final ObjectMapper json;
  private final Map<String, JsonSchema> schemas = new HashMap<>();

  public ProcessingEvents(ObjectMapper json) throws java.io.IOException {
    this.json = json;
    SchemaValidatorsConfig config = new SchemaValidatorsConfig();
    config.setFormatAssertionsEnabled(true);
    for (String topic :
        List.of(
            "document.version.saved.v1",
            "processing.job.requested.v1",
            "processing.job.completed.v1",
            "editor.dead-letter.v1")) {
      try (var in = getClass().getResourceAsStream("/contracts/events/" + topic + ".schema.json")) {
        schemas.put(
            topic,
            JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V202012).getSchema(in, config));
      }
    }
  }

  public Map<String, Object> parse(String topic, String raw) {
    if (raw == null
        || raw.getBytes(java.nio.charset.StandardCharsets.UTF_8).length
            > (topic.equals("editor.dead-letter.v1") ? 131072 : 65536))
      throw new IllegalArgumentException("INVALID_SCHEMA_REDACTED");
    try {
      JsonNode node = json.readTree(raw);
      if (!schemas.containsKey(topic) || !schemas.get(topic).validate(node).isEmpty())
        throw new IllegalArgumentException("INVALID_SCHEMA_REDACTED");
      return json.convertValue(node, Map.class);
    } catch (java.io.IOException e) {
      throw new IllegalArgumentException("INVALID_SCHEMA_REDACTED");
    }
  }

  String encode(Object value) {
    try {
      return json.writeValueAsString(value);
    } catch (Exception e) {
      throw new IllegalArgumentException("Invalid event");
    }
  }

  Map<String, Object> envelope(String type, Map<String, Object> payload) {
    Map<String, Object> e = new LinkedHashMap<>();
    e.put("eventId", UUID.randomUUID().toString());
    e.put("eventType", type);
    e.put("schemaVersion", 1);
    e.put("occurredAt", Instant.now().toString());
    e.put(
        "producer",
        type.equals("ConsumerDeadLetter") ? "consumer-error-handler" : "processing-service");
    e.put("traceId", TraceContext.traceId());
    e.put("payload", payload);
    return e;
  }

  void insert(
      JdbcTemplate db, String topic, String aggregate, long revision, Map<String, Object> event) {
    String raw = encode(event);
    parse(topic, raw);
    db.update(
        "INSERT INTO outbox_events(event_id,aggregate_id,aggregate_revision,topic,event_key,payload,created_at,next_attempt_at) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))",
        event.get("eventId"),
        aggregate,
        revision,
        topic,
        aggregate,
        raw);
  }
}
