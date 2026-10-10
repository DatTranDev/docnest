package vn.editor.payment.billing.application.command;

import java.util.Map;
import java.util.UUID;

public interface BillingCommandService {
  Map<String, Object> request(UUID userId, UUID key, String kind, String plan);

  void webhook(String eventId, String fingerprint, String type, String customer);

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
