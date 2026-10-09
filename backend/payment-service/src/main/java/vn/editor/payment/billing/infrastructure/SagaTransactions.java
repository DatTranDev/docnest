package vn.editor.payment.billing.infrastructure;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import vn.editor.common.messaging.JdbcMessageLog;
import vn.editor.common.messaging.MessageEnvelope;
import vn.editor.payment.billing.application.port.PaymentGateway;
import vn.editor.payment.billing.domain.BillingFailure;
import vn.editor.payment.billing.domain.BillingSaga;

@Component
public final class SagaTransactions {
  private final JdbcTemplate jdbc;
  private final JdbcMessageLog messages;

  public SagaTransactions(JdbcTemplate jdbc, JdbcMessageLog messages) {
    this.jdbc = jdbc;
    this.messages = messages;
  }

  /** Called with the owning payment account locked, inside its transaction. */
  public void reconcile(
      UUID userId, Map<String, Object> account, PaymentGateway.Snapshot snapshot) {
    if (snapshot.checkoutRequestId() != null
        && jdbc.queryForObject(
                "SELECT COUNT(*) FROM payment_requests WHERE id=? AND user_id=? AND kind='CHECKOUT'",
                Integer.class,
                snapshot.checkoutRequestId().toString(),
                userId.toString())
            != 1) throw new BillingFailure("STRIPE_REVIEW_REQUIRED");
    jdbc.update(
        "UPDATE payment_accounts SET subscription_id=?,stripe_status=?,cancel_at_period_end=? WHERE user_id=?",
        snapshot.subscriptionId(),
        snapshot.status(),
        snapshot.cancelAtPeriodEnd(),
        userId.toString());
    if (account.get("plan").equals(snapshot.plan())
        && Objects.equals(instant(account.get("expires_at")), snapshot.expiresAt())) return;
    if (account.get("saga_id") != null
        && jdbc.queryForObject(
                "SELECT COUNT(*) FROM payment_sagas WHERE id=? AND state IN ('PROVISIONING','COMPENSATING')",
                Integer.class,
                account.get("saga_id"))
            != 0) throw new BillingFailure("SAGA_BUSY");
    UUID saga = UUID.randomUUID();
    long generation = ((Number) account.get("generation")).longValue() + 1;
    String trace = UUID.randomUUID().toString().replace("-", "");
    jdbc.update(
        "INSERT INTO payment_sagas(id,user_id,generation,plan,expires_at,previous_plan,previous_expires_at,trace_id) VALUES(?,?,?,?,?,?,?,?)",
        saga.toString(),
        userId.toString(),
        generation,
        snapshot.plan(),
        timestamp(snapshot.expiresAt()),
        account.get("plan"),
        account.get("expires_at"),
        trace);
    jdbc.update(
        "UPDATE payment_accounts SET generation=?,saga_id=? WHERE user_id=?",
        generation,
        saga.toString(),
        userId.toString());
    commands(userId, saga, generation, "APPLY", snapshot.plan(), snapshot.expiresAt(), trace);
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
    messages.receive(
        eventId,
        raw,
        () -> {
          // Lock order is account then saga in every path.
          var accounts =
              jdbc.queryForList(
                  "SELECT * FROM payment_accounts WHERE user_id=? FOR UPDATE", userId.toString());
          if (accounts.isEmpty() || !sagaId.toString().equals(accounts.getFirst().get("saga_id")))
            return;
          var rows =
              jdbc.queryForList(
                  "SELECT * FROM payment_sagas WHERE id=? AND user_id=? FOR UPDATE",
                  sagaId.toString(),
                  userId.toString());
          if (rows.isEmpty()) return;
          var saga = rows.getFirst();
          var entity =
              new BillingSaga(
                  ((Number) saga.get("generation")).longValue(),
                  (String) saga.get("phase"),
                  (String) saga.get("state"),
                  ((Number) saga.get("replies")).intValue());
          var result = entity.acknowledge(generation, phase, participant, outcome);
          switch (result.decision()) {
            case IGNORE -> {
              return;
            }
            case WAIT ->
                jdbc.update(
                    "UPDATE payment_sagas SET replies=? WHERE id=?",
                    result.replies(),
                    sagaId.toString());
            case ACTIVATE -> {
              jdbc.update(
                  "UPDATE payment_sagas SET replies=?,state='COMPLETE' WHERE id=?",
                  result.replies(),
                  sagaId.toString());
              jdbc.update(
                  "UPDATE payment_accounts SET plan=?,expires_at=? WHERE user_id=?",
                  saga.get("plan"),
                  saga.get("expires_at"),
                  userId.toString());
            }
            case COMPENSATE -> {
              long next = entity.generation() + 1;
              jdbc.update(
                  "UPDATE payment_sagas SET generation=?,phase='COMPENSATE',state='COMPENSATING',replies=0 WHERE id=?",
                  next,
                  sagaId.toString());
              jdbc.update(
                  "UPDATE payment_accounts SET generation=?,review_needed=1 WHERE user_id=?",
                  next,
                  userId.toString());
              commands(
                  userId,
                  sagaId,
                  next,
                  "COMPENSATE",
                  (String) saga.get("previous_plan"),
                  instant(saga.get("previous_expires_at")),
                  (String) saga.get("trace_id"));
              if (accounts.getFirst().get("subscription_id") != null) {
                UUID cancellation =
                    UUID.nameUUIDFromBytes(
                        ("compensate-cancel-" + sagaId)
                            .getBytes(java.nio.charset.StandardCharsets.US_ASCII));
                jdbc.update(
                    "INSERT INTO payment_requests(id,user_id,request_key,kind,plan,expires_at) VALUES(?,?,?,'CANCEL','FREE',TIMESTAMPADD(SECOND,7200,CURRENT_TIMESTAMP(6))) ON DUPLICATE KEY UPDATE id=id",
                    cancellation.toString(),
                    userId.toString(),
                    cancellation.toString());
              }
            }
            case REVIEW -> {
              jdbc.update(
                  "UPDATE payment_sagas SET replies=?,state='MANUAL_REVIEW' WHERE id=?",
                  result.replies(),
                  sagaId.toString());
              jdbc.update(
                  "UPDATE payment_accounts SET plan=?,expires_at=?,review_needed=1 WHERE user_id=?",
                  saga.get("previous_plan"),
                  saga.get("previous_expires_at"),
                  userId.toString());
            }
          }
        });
  }

  /**
   * Republish unfinished phase commands so Kafka retention/consumer outages do not strand sagas.
   */
  public void recover() {
    jdbc.update(
        "UPDATE saga_outbox o JOIN payment_sagas s ON o.aggregate_key=s.user_id SET o.published_at=NULL,o.next_attempt_at=CURRENT_TIMESTAMP(6) WHERE s.state IN ('PROVISIONING','COMPENSATING') AND o.topic LIKE 'billing.%.command.v1' AND o.payload->>'$.payload.sagaId'=s.id AND o.payload->>'$.payload.generation'=CAST(s.generation AS CHAR) AND o.payload->>'$.payload.phase'=s.phase AND (o.lease_until IS NULL OR o.lease_until<CURRENT_TIMESTAMP(6))");
  }

  private void commands(
      UUID userId,
      UUID saga,
      long generation,
      String phase,
      String plan,
      Instant expiresAt,
      String trace) {
    Map<String, Object> payload = new HashMap<>();
    payload.put("userId", userId.toString());
    payload.put("sagaId", saga.toString());
    payload.put("generation", generation);
    payload.put("phase", phase);
    payload.put("plan", plan);
    payload.put("expiresAt", expiresAt == null ? null : expiresAt.toString());
    for (String participant :
        java.util.List.of("identity", "document", "processing", "collaboration")) {
      UUID event = UUID.randomUUID();
      messages.enqueue(
          event,
          "billing." + participant + ".command.v1",
          userId.toString(),
          MessageEnvelope.encode(event, "EntitlementRequested", "payment-service", trace, payload));
    }
  }

  static Instant instant(Object value) {
    return value == null
        ? null
        : value instanceof java.time.LocalDateTime local
            ? local.toInstant(java.time.ZoneOffset.UTC)
            : ((Timestamp) value).toInstant();
  }

  static Timestamp timestamp(Instant value) {
    return value == null ? null : Timestamp.from(value);
  }
}
