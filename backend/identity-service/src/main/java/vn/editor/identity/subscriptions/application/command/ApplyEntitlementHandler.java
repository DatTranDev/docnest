package vn.editor.identity.subscriptions.application.command;

import java.util.UUID;
import vn.editor.identity.subscriptions.application.port.EntitlementStore;
import vn.editor.identity.subscriptions.domain.PlanGrant;

public final class ApplyEntitlementHandler {
  private final EntitlementStore store;

  public ApplyEntitlementHandler(EntitlementStore store) {
    this.store = store;
  }

  public void handle(UUID eventId, PlanGrant grant, String traceId, String raw) {
    store.apply(eventId, grant, traceId, raw);
  }
}
