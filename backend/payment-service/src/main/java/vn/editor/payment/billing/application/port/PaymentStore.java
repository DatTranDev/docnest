package vn.editor.payment.billing.application.port;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public interface PaymentStore {
  record Work(
      UUID userId,
      UUID lease,
      UUID requestId,
      String kind,
      String plan,
      String customer,
      String subscriptionId,
      Instant expiresAt,
      long syncRevision) {}

  Map<String, Object> enqueue(UUID userId, UUID key, String kind, String plan);

  Map<String, Object> request(UUID userId, UUID id);

  Map<String, Object> subscription(UUID userId);

  void receipt(String eventId, String fingerprint, String eventType, String customer);

  Work claim();

  void customer(Work work, String customer);

  void finish(Work work, String url, PaymentGateway.Snapshot snapshot);

  void retry(Work work, String code);

  void reply(
      UUID eventId,
      String raw,
      UUID userId,
      UUID sagaId,
      long generation,
      String phase,
      String participant,
      String outcome);
}
