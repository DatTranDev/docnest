package vn.editor.payment.billing.application.command;

import vn.editor.payment.billing.application.port.PaymentGateway;
import vn.editor.payment.billing.application.port.PaymentRepository;
import vn.editor.payment.billing.domain.BillingFailure;

public final class RunBillingWorkHandler {
  private final PaymentRepository store;
  private final PaymentGateway gateway;

  public RunBillingWorkHandler(PaymentRepository store, PaymentGateway gateway) {
    this.store = store;
    this.gateway = gateway;
  }

  public void handle() {
    if (!gateway.enabled()) return;
    var work = store.claim();
    if (work == null) return;
    try {
      if (work.requestId() != null && !work.expiresAt().isAfter(java.time.Instant.now()))
        throw new BillingFailure("BILLING_REQUEST_EXPIRED");
      String customer = work.customer();
      if (customer == null) {
        customer = gateway.customer(work.userId());
        store.customer(work, customer);
      }
      switch (work.kind()) {
        case "CHECKOUT" -> {
          var current = gateway.current(work.userId(), customer);
          if (current.subscriptionId() != null) store.finish(work, null, current);
          else
            store.finish(
                work,
                gateway.checkout(
                    work.requestId(), work.userId(), customer, work.plan(), work.expiresAt()),
                null);
        }
        case "PORTAL" -> store.finish(work, gateway.portal(work.requestId(), customer), null);
        case "CANCEL" -> {
          gateway.cancel(work.requestId(), work.subscriptionId());
          store.finish(work, null, null);
        }
        case "SYNC" -> store.finish(work, null, gateway.current(work.userId(), customer));
        default -> throw new BillingFailure("INVALID_BILLING_WORK");
      }
    } catch (BillingFailure failed) {
      store.retry(work, failed.getMessage());
    }
  }
}
