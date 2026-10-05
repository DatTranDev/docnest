package vn.editor.document.documents.infrastructure;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vn.editor.document.documents.application.command.RetentionCommandHandler;

@Component
public final class RetentionSchedule {
  private final RetentionCommandHandler handler;

  public RetentionSchedule(RetentionCommandHandler handler) {
    this.handler = handler;
  }

  @Scheduled(fixedDelay = 60000)
  public void collect() {
    try {
      handler.collect();
    } catch (RuntimeException ex) {
      /* Keep durable state for the next scan if a dependency is unavailable. */
    }
  }
}
