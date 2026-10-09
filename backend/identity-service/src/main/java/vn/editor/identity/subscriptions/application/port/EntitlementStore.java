package vn.editor.identity.subscriptions.application.port;

import java.util.UUID;
import vn.editor.identity.subscriptions.domain.PlanGrant;

public interface EntitlementStore {
  void apply(UUID eventId, PlanGrant grant, String traceId, String raw);
}
