package vn.editor.payment.billing.application.command;

import java.util.Map;
import java.util.UUID;
import vn.editor.payment.billing.application.port.PaymentGateway;
import vn.editor.payment.billing.application.port.PaymentRepository;
import vn.editor.payment.billing.application.port.StripeSignatures;
import vn.editor.payment.billing.domain.BillingFailure;
import vn.editor.payment.billing.domain.BillingPolicy;

public final class BillingCommandHandler implements BillingCommandService {
  private final PaymentRepository store;
  private final PaymentGateway gateway;
  private final StripeSignatures signatures;

  public BillingCommandHandler(
      PaymentRepository store, PaymentGateway gateway, StripeSignatures signatures) {
    this.store = store;
    this.gateway = gateway;
    this.signatures = signatures;
  }

  public Map<String, Object> request(UUID userId, UUID key, String kind, String plan) {
    if (!gateway.enabled() || !signatures.configured())
      throw new BillingFailure("STRIPE_NOT_CONFIGURED");
    if (kind.equals("CHECKOUT")) BillingPolicy.checkout(plan);
    return store.enqueue(userId, key, kind, plan);
  }

  public void webhook(String eventId, String fingerprint, String type, String customer) {
    store.receipt(eventId, fingerprint, type, customer);
  }

  public void reply(
      UUID eventId,
      String raw,
      UUID userId,
      UUID sagaId,
      long generation,
      String phase,
      String participant,
      String outcome) {
    store.reply(eventId, raw, userId, sagaId, generation, phase, participant, outcome);
  }
}
