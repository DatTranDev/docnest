package vn.editor.document.documents.application.command;

import java.util.UUID;
import vn.editor.document.documents.application.port.EventPublisher;
import vn.editor.document.documents.application.port.OutboxRepository;

public final class RelayOutboxCommandHandler {
  private final OutboxRepository outbox;
  private final EventPublisher publisher;
  private final String leaseOwner = UUID.randomUUID().toString();

  public RelayOutboxCommandHandler(OutboxRepository outbox, EventPublisher publisher) {
    this.outbox = outbox;
    this.publisher = publisher;
  }

  public void handle(RelayOutboxCommand command) {
    for (int count = 0; count < command.batchSize(); count++) {
      OutboxRepository.Message message = outbox.claim(leaseOwner);
      if (message == null) return;
      try {
        publisher.publish(message.topic(), message.key(), message.payload());
        outbox.published(message.id(), leaseOwner);
      } catch (Exception ex) {
        outbox.retry(
            message.id(),
            leaseOwner,
            message.previousAttempts() + 1,
            ex instanceof IllegalArgumentException ? "INVALID_EVENT_SCHEMA" : "BROKER_UNAVAILABLE");
        return;
      }
    }
  }
}
