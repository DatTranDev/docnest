package vn.editor.collaboration.subscriptions.application.port;

import java.util.UUID;
import vn.editor.collaboration.subscriptions.domain.PlanGrant;

public interface EntitlementRepository {
  void apply(UUID eventId, PlanGrant grant, String traceId, String raw);
}
