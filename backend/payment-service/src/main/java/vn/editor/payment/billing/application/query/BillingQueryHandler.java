package vn.editor.payment.billing.application.query;

import java.util.Map;
import java.util.UUID;
import vn.editor.payment.billing.application.port.PaymentStore;

public final class BillingQueryHandler {
  private final PaymentStore store;

  public BillingQueryHandler(PaymentStore store) {
    this.store = store;
  }

  public Map<String, Object> subscription(UUID userId) {
    return store.subscription(userId);
  }

  public Map<String, Object> request(UUID userId, UUID id) {
    return store.request(userId, id);
  }
}
