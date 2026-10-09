package vn.editor.processing.subscriptions.application.port;

import java.util.UUID;
import vn.editor.processing.subscriptions.domain.PlanGrant;

public interface EntitlementStore {
  void apply(UUID eventId, PlanGrant grant, String traceId, String raw);
}
