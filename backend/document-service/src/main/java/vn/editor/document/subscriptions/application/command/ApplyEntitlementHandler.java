package vn.editor.document.subscriptions.application.command;

import java.util.UUID;
import vn.editor.document.subscriptions.application.port.EntitlementRepository;
import vn.editor.document.subscriptions.domain.PlanGrant;

public final class ApplyEntitlementHandler {
  private final EntitlementRepository store;

  public ApplyEntitlementHandler(EntitlementRepository store) {
    this.store = store;
  }

  public void handle(UUID eventId, PlanGrant grant, String traceId, String raw) {
    store.apply(eventId, grant, traceId, raw);
  }
}
