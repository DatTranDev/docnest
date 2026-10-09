package vn.editor.common.messaging;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public final class MessageEnvelope {
  private static final ObjectMapper JSON = new ObjectMapper();

  public static String encode(
      UUID eventId, String type, String producer, String traceId, Map<String, Object> payload) {
    try {
      return JSON.writeValueAsString(
          Map.of(
              "eventId",
              eventId.toString(),
              "eventType",
              type,
              "schemaVersion",
              1,
              "occurredAt",
              Instant.now().toString(),
              "producer",
              producer,
              "traceId",
              traceId,
              "payload",
              payload));
    } catch (JsonProcessingException impossible) {
      throw new IllegalArgumentException("INVALID_ENVELOPE");
    }
  }

  private MessageEnvelope() {}
}
