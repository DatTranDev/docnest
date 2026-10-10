package vn.editor.payment.billing.application.query;

import java.util.Map;
import java.util.UUID;
import vn.editor.payment.billing.application.port.PaymentRepository;

public final class BillingQueryHandler implements BillingQueryService {
  private final PaymentRepository store;

  public BillingQueryHandler(PaymentRepository store) {
    this.store = store;
  }

  public Map<String, Object> subscription(UUID userId) {
    return store.subscription(userId);
  }

  public Map<String, Object> request(UUID userId, UUID id) {
    return store.request(userId, id);
  }
}
