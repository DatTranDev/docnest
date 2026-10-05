package vn.editor.document.documents.infrastructure;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vn.editor.document.documents.application.command.RelayOutboxCommand;
import vn.editor.document.documents.application.command.RelayOutboxCommandHandler;

@Component
public final class OutboxSchedule {
  private final RelayOutboxCommandHandler handler;

  public OutboxSchedule(RelayOutboxCommandHandler handler) {
    this.handler = handler;
  }

  @Scheduled(fixedDelay = 1000)
  public void relay() {
    handler.handle(new RelayOutboxCommand(100));
  }
}
