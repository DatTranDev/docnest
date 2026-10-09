package vn.editor.payment.billing.application.port;

import java.time.Instant;
import java.util.UUID;

public interface PaymentGateway {
  record Snapshot(
      String subscriptionId,
      String plan,
      Instant expiresAt,
      String status,
      boolean cancelAtPeriodEnd,
      UUID checkoutRequestId) {}

  boolean enabled();

  String customer(UUID userId);

  String checkout(UUID id, UUID userId, String customer, String plan, Instant expiresAt);

  String portal(UUID id, String customer);

  void cancel(UUID id, String subscriptionId);

  Snapshot current(UUID userId, String customer);
}
