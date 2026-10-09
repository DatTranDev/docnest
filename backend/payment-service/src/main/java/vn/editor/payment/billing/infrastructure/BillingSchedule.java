package vn.editor.payment.billing.infrastructure;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vn.editor.common.messaging.EventSchemas;
import vn.editor.common.messaging.KafkaMessageRelay;
import vn.editor.payment.billing.application.command.BillingCommandHandler;
import vn.editor.payment.billing.application.command.RunBillingWorkHandler;

@Component
public final class BillingSchedule {
  private final BillingCommandHandler commands;
  private final RunBillingWorkHandler worker;
  private final KafkaMessageRelay relay;
  private final SagaTransactions sagas;
  private final ObjectMapper json = new ObjectMapper();

  public BillingSchedule(
      BillingCommandHandler commands,
      RunBillingWorkHandler worker,
      KafkaMessageRelay relay,
      SagaTransactions sagas) {
    this.commands = commands;
    this.worker = worker;
    this.relay = relay;
    this.sagas = sagas;
  }

  @Scheduled(fixedDelay = 60000)
  public void recover() {
    sagas.recover();
  }

  @Scheduled(fixedDelay = 500)
  public void relay() {
    relay.relay();
  }

  @Scheduled(fixedDelay = 1000)
  public void work() {
    try {
      worker.handle();
    } catch (RuntimeException unavailable) {
      // Lease expiry recovers interrupted/SQL-failed work. No Stripe payload/URL/exception logging.
    }
  }

  @KafkaListener(
      topics = {
        "billing.identity.reply.v1",
        "billing.document.reply.v1",
        "billing.processing.reply.v1",
        "billing.collaboration.reply.v1"
      },
      groupId = "billing-payment-v1",
      containerFactory = "sagaKafkaFactory")
  public void receive(ConsumerRecord<String, String> record, Acknowledgment ack) throws Exception {
    if (!EventSchemas.valid(record.topic(), record.value())) {
      relay.deadLetter(
          "payment-service",
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
          "payment-service",
          record.topic(),
          record.key(),
          record.value(),
          record.partition(),
          record.offset(),
          false);
      ack.acknowledge();
      return;
    }
    commands.reply(
        UUID.fromString(envelope.path("eventId").asText()),
        record.value(),
        UUID.fromString(user),
        UUID.fromString(payload.path("sagaId").asText()),
        payload.path("generation").asLong(),
        payload.path("phase").asText(),
        payload.path("participant").asText(),
        payload.path("outcome").asText());
    ack.acknowledge();
  }
}
