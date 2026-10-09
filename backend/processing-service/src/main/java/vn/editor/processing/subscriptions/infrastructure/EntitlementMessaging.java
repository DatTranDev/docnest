package vn.editor.processing.subscriptions.infrastructure;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.UUID;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vn.editor.common.messaging.EventSchemas;
import vn.editor.common.messaging.KafkaMessageRelay;
import vn.editor.processing.subscriptions.application.command.ApplyEntitlementHandler;
import vn.editor.processing.subscriptions.domain.PlanGrant;

@Component
public final class EntitlementMessaging {
  private final ApplyEntitlementHandler handler;
  private final KafkaMessageRelay relay;
  private final ObjectMapper json = new ObjectMapper();

  public EntitlementMessaging(ApplyEntitlementHandler handler, KafkaMessageRelay relay) {
    this.handler = handler;
    this.relay = relay;
  }

  @Scheduled(fixedDelay = 500)
  public void relay() {
    relay.relay();
  }

  @KafkaListener(
      topics = "billing.processing.command.v1",
      groupId = "billing-processing-v1",
      containerFactory = "sagaKafkaFactory")
  public void receive(ConsumerRecord<String, String> record, Acknowledgment ack) throws Exception {
    if (!EventSchemas.valid(record.topic(), record.value())) {
      relay.deadLetter(
          "processing-service",
          record.topic(),
          record.key(),
          record.value(),
          record.partition(),
          record.offset(),
          false);
      ack.acknowledge();
      return;
    }
    var envelope = json.readTree(record.value());
    var payload = envelope.path("payload");
    String user = payload.path("userId").asText();
    if (!user.equals(record.key())) {
      relay.deadLetter(
          "processing-service",
          record.topic(),
          record.key(),
          record.value(),
          record.partition(),
          record.offset(),
          false);
      ack.acknowledge();
      return;
    }
    handler.handle(
        UUID.fromString(envelope.path("eventId").asText()),
        new PlanGrant(
            UUID.fromString(user),
            UUID.fromString(payload.path("sagaId").asText()),
            payload.path("generation").asLong(),
            payload.path("phase").asText(),
            payload.path("plan").asText(),
            payload.path("expiresAt").isNull()
                ? null
                : Instant.parse(payload.path("expiresAt").asText())),
        envelope.path("traceId").asText(),
        record.value());
    ack.acknowledge();
  }
}
