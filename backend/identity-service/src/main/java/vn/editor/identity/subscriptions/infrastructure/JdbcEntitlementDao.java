package vn.editor.identity.subscriptions.infrastructure;

import java.sql.Timestamp;
import java.util.HashMap;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import vn.editor.common.messaging.JdbcMessageLog;
import vn.editor.common.messaging.MessageEnvelope;
import vn.editor.identity.subscriptions.application.port.EntitlementRepository;
import vn.editor.identity.subscriptions.domain.PlanGrant;

@Repository
public class JdbcEntitlementDao implements EntitlementRepository {
  private final JdbcTemplate jdbc;
  private final JdbcMessageLog messages;

  public JdbcEntitlementDao(JdbcTemplate jdbc, JdbcMessageLog messages) {
    this.jdbc = jdbc;
    this.messages = messages;
  }

  public void apply(UUID eventId, PlanGrant grant, String traceId, String raw) {
    boolean applied =
        messages.receive(
            eventId,
            raw,
            () -> {
              jdbc.update(
                  "INSERT INTO subscription_entitlements(user_id) VALUES(?) ON DUPLICATE KEY UPDATE user_id=user_id",
                  grant.userId().toString());
              long previous =
                  jdbc.queryForObject(
                      "SELECT generation FROM subscription_entitlements WHERE user_id=? FOR UPDATE",
                      Long.class,
                      grant.userId().toString());
              boolean active =
                  jdbc.queryForObject(
                          "SELECT COUNT(*) FROM users WHERE id=? AND status='ACTIVE'",
                          Integer.class,
                          grant.userId().toString())
                      == 1;
              String outcome = "APPLIED", reason = "NONE";
              if (!grant.canApply(active)) {
                outcome = "REJECTED";
                reason = "ACCOUNT_INACTIVE";
              } else if (grant.supersedes(previous)) {
                jdbc.update(
                    "UPDATE subscription_entitlements SET generation=?,plan=?,expires_at=?,saga_id=?,phase=? WHERE user_id=?",
                    grant.generation(),
                    grant.plan(),
                    grant.expiresAt() == null ? null : Timestamp.from(grant.expiresAt()),
                    grant.sagaId().toString(),
                    grant.phase(),
                    grant.userId().toString());
              } else if (grant.generation() == previous) {
                var stored =
                    jdbc.queryForMap(
                        "SELECT saga_id,phase,plan,expires_at FROM subscription_entitlements WHERE user_id=?",
                        grant.userId().toString());
                if (!grant.sagaId().toString().equals(stored.get("saga_id"))
                    || !grant.phase().equals(stored.get("phase"))
                    || !grant.plan().equals(stored.get("plan"))
                    || !java.util.Objects.equals(
                        grant.expiresAt(),
                        stored.get("expires_at") == null
                            ? null
                            : stored.get("expires_at") instanceof java.time.LocalDateTime local
                                ? local.toInstant(java.time.ZoneOffset.UTC)
                                : ((Timestamp) stored.get("expires_at")).toInstant())) {
                  outcome = "REJECTED";
                  reason = "STALE";
                }
              } else {
                outcome = "REJECTED";
                reason = "STALE";
              }
              UUID reply = UUID.randomUUID();
              var payload = new HashMap<String, Object>();
              payload.put("userId", grant.userId().toString());
              payload.put("sagaId", grant.sagaId().toString());
              payload.put("generation", grant.generation());
              payload.put("phase", grant.phase());
              payload.put("participant", "identity");
              payload.put("outcome", outcome);
              payload.put("reason", reason);
              messages.enqueue(
                  reply,
                  "billing.identity.reply.v1",
                  grant.userId().toString(),
                  MessageEnvelope.encode(
                      reply, "EntitlementCompleted", "identity-service", traceId, payload));
            });
    if (!applied)
      jdbc.update(
          "UPDATE saga_outbox SET published_at=NULL,next_attempt_at=CURRENT_TIMESTAMP(6) WHERE topic='billing.identity.reply.v1' AND aggregate_key=? AND payload->>'$.payload.sagaId'=? AND payload->>'$.payload.generation'=? AND payload->>'$.payload.phase'=? AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP(6))",
          grant.userId().toString(),
          grant.sagaId().toString(),
          Long.toString(grant.generation()),
          grant.phase());
  }
}
