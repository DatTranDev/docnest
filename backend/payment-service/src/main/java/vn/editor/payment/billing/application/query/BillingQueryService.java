package vn.editor.payment.billing.application.query;

import java.util.Map;
import java.util.UUID;

public interface BillingQueryService {
  Map<String, Object> subscription(UUID userId);

  Map<String, Object> request(UUID userId, UUID id);
}
