package vn.editor.document.subscriptions.application.port;

import java.util.UUID;
import vn.editor.document.subscriptions.domain.PlanGrant;

public interface EntitlementRepository {
  void apply(UUID eventId, PlanGrant grant, String traceId, String raw);
}
