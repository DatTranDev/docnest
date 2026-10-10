package vn.editor.payment.billing.infrastructure;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;
import vn.editor.payment.billing.application.port.PaymentGateway;
import vn.editor.payment.billing.application.port.PaymentRepository;
import vn.editor.payment.billing.domain.BillingFailure;
import vn.editor.payment.billing.domain.BillingPolicy;

@Repository
public class JdbcPaymentDao implements PaymentRepository {
  private final JdbcTemplate jdbc;
  private final TransactionTemplate transactions;
  private final SagaTransactions sagas;

  public JdbcPaymentDao(
      JdbcTemplate jdbc, TransactionTemplate transactions, SagaTransactions sagas) {
    this.jdbc = jdbc;
    this.transactions = transactions;
    this.sagas = sagas;
  }

  @Override
  public Map<String, Object> enqueue(UUID userId, UUID key, String kind, String plan) {
    for (int attempt = 0; ; attempt++) {
      try {
        return enqueueTransaction(userId, key, kind, plan);
      } catch (org.springframework.dao.PessimisticLockingFailureException collision) {
        if (attempt >= 4) throw collision;
      }
    }
  }

  private Map<String, Object> enqueueTransaction(UUID userId, UUID key, String kind, String plan) {
    BillingPolicy.requestKind(kind);
    return transactions.execute(
        status -> {
          jdbc.update(
              "INSERT INTO payment_accounts(user_id) VALUES(?) ON DUPLICATE KEY UPDATE user_id=user_id",
              userId.toString());
          var account =
              jdbc.queryForMap(
                  "SELECT * FROM payment_accounts WHERE user_id=? FOR UPDATE", userId.toString());
          var previous =
              jdbc.queryForList(
                  "SELECT id,kind,plan FROM payment_requests WHERE user_id=? AND request_key=?",
                  userId.toString(),
                  key.toString());
          if (!previous.isEmpty()) {
            var row = previous.getFirst();
            if (!row.get("kind").equals(kind) || !row.get("plan").equals(plan))
              throw new BillingFailure("IDEMPOTENCY_CONFLICT");
            return request(userId, UUID.fromString((String) row.get("id")));
          }
          var eligibility =
              new BillingPolicy.RequestEligibility(
                  (String) account.get("plan"),
                  SagaTransactions.instant(account.get("expires_at")),
                  account.get("customer_id") != null,
                  account.get("subscription_id") != null,
                  ((Number) account.get("review_needed")).intValue() == 1);
          int checkouts =
              kind.equals("CHECKOUT")
                  ? jdbc.queryForObject(
                      "SELECT COUNT(*) FROM payment_requests WHERE user_id=? AND kind='CHECKOUT' AND expires_at>CURRENT_TIMESTAMP(6)",
                      Integer.class,
                      userId.toString())
                  : 0;
          int queued =
              jdbc.queryForObject(
                  "SELECT COUNT(*) FROM payment_requests WHERE user_id=? AND status IN ('PENDING','RUNNING')",
                  Integer.class,
                  userId.toString());
          eligibility.require(kind, checkouts, queued, Instant.now());
          UUID id = UUID.randomUUID();
          jdbc.update(
              "INSERT INTO payment_requests(id,user_id,request_key,kind,plan,expires_at) VALUES(?,?,?,?,?,TIMESTAMPADD(SECOND,7200,CURRENT_TIMESTAMP(6)))",
              id.toString(),
              userId.toString(),
              key.toString(),
              kind,
              plan);
          if (kind.equals("SYNC"))
            jdbc.update(
                "UPDATE payment_accounts SET review_needed=0 WHERE user_id=?", userId.toString());
          return request(userId, id);
        });
  }

  @Override
  public Map<String, Object> request(UUID userId, UUID id) {
    var rows =
        jdbc.queryForList(
            "SELECT id,kind,plan,status,result_url,error_code,expires_at FROM payment_requests WHERE id=? AND user_id=?",
            id.toString(),
            userId.toString());
    if (rows.isEmpty()) throw new BillingFailure("BILLING_NOT_FOUND");
    var row = rows.getFirst();
    var result = new HashMap<String, Object>();
    result.put("id", row.get("id"));
    result.put("kind", row.get("kind"));
    result.put("status", row.get("status"));
    result.put("errorCode", row.get("error_code"));
    boolean expired = !SagaTransactions.instant(row.get("expires_at")).isAfter(Instant.now());
    result.put("url", expired ? null : row.get("result_url"));
    result.put("expiresAt", SagaTransactions.instant(row.get("expires_at")).toString());
    return result;
  }

  @Override
  public Map<String, Object> subscription(UUID userId) {
    var rows =
        jdbc.queryForList(
            "SELECT p.*,s.state saga_state FROM payment_accounts p LEFT JOIN payment_sagas s ON p.saga_id=s.id WHERE p.user_id=?",
            userId.toString());
    var result = new HashMap<String, Object>();
    result.put("plan", "FREE");
    result.put("state", "NONE");
    result.put("stripeStatus", "none");
    result.put("cancelAtPeriodEnd", false);
    result.put("expiresAt", null);
    result.put("sagaId", null);
    if (rows.isEmpty()) return result;
    var row = rows.getFirst();
    Instant expires = SagaTransactions.instant(row.get("expires_at"));
    result.put("plan", BillingPolicy.effective((String) row.get("plan"), expires, Instant.now()));
    result.put(
        "state",
        ((Number) row.get("review_needed")).intValue() == 1
            ? "MANUAL_REVIEW"
            : row.get("saga_state") == null ? "NONE" : row.get("saga_state"));
    result.put("stripeStatus", row.get("stripe_status"));
    result.put("expiresAt", expires == null ? null : expires.toString());
    result.put("cancelAtPeriodEnd", ((Number) row.get("cancel_at_period_end")).intValue() == 1);
    result.put("sagaId", row.get("saga_id"));
    return result;
  }

  @Override
  public void receipt(String eventId, String fingerprint, String eventType, String customer) {
    transactions.executeWithoutResult(
        status -> {
          jdbc.update(
              "INSERT INTO stripe_receipts(event_id,fingerprint,event_type,customer_id) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE event_id=event_id",
              eventId,
              fingerprint,
              eventType,
              customer);
          String prior =
              jdbc.queryForObject(
                  "SELECT fingerprint FROM stripe_receipts WHERE event_id=? FOR UPDATE",
                  String.class,
                  eventId);
          if (!fingerprint.equals(prior)) throw new BillingFailure("WEBHOOK_ID_CONFLICT");
          // Repeated wakeups are harmless and ensure a duplicate can repair a failed
          // synchronization.
          if (customer != null)
            jdbc.update(
                "UPDATE payment_accounts SET sync_revision=sync_revision+1,next_sync_at=CURRENT_TIMESTAMP(6) WHERE customer_id=?",
                customer);
        });
  }

  @Override
  public Work claim() {
    return transactions.execute(
        status -> {
          var accounts =
              jdbc.queryForList(
                  "SELECT p.* FROM payment_accounts p LEFT JOIN payment_sagas s ON p.saga_id=s.id WHERE (p.work_until IS NULL OR p.work_until<CURRENT_TIMESTAMP(6)) AND (EXISTS(SELECT 1 FROM payment_requests r WHERE r.user_id=p.user_id AND r.status IN ('PENDING','RUNNING') AND r.next_attempt_at<=CURRENT_TIMESTAMP(6)) OR (p.customer_id IS NOT NULL AND p.review_needed=0 AND p.next_sync_at<=CURRENT_TIMESTAMP(6) AND (s.state IS NULL OR s.state NOT IN ('PROVISIONING','COMPENSATING')))) ORDER BY p.next_sync_at LIMIT 1 FOR UPDATE SKIP LOCKED");
          if (accounts.isEmpty()) return null;
          var account = accounts.getFirst();
          UUID user = UUID.fromString((String) account.get("user_id"));
          UUID lease = UUID.randomUUID();
          jdbc.update(
              "UPDATE payment_accounts SET work_lease=?,work_until=TIMESTAMPADD(SECOND,120,CURRENT_TIMESTAMP(6)) WHERE user_id=?",
              lease.toString(),
              user.toString());
          var requests =
              jdbc.queryForList(
                  "SELECT * FROM payment_requests WHERE user_id=? AND status IN ('PENDING','RUNNING') AND next_attempt_at<=CURRENT_TIMESTAMP(6) ORDER BY CASE WHEN kind='CANCEL' THEN 0 WHEN kind='PORTAL' THEN 1 ELSE 2 END,created_at LIMIT 1",
                  user.toString());
          UUID id = null;
          String kind = "SYNC", plan = "FREE";
          Instant expires = Instant.now().plusSeconds(1800);
          if (!requests.isEmpty()) {
            var request = requests.getFirst();
            id = UUID.fromString((String) request.get("id"));
            kind = (String) request.get("kind");
            plan = (String) request.get("plan");
            expires = SagaTransactions.instant(request.get("expires_at"));
            jdbc.update(
                "UPDATE payment_requests SET status='RUNNING',attempts=attempts+1 WHERE id=?",
                id.toString());
          }
          return new Work(
              user,
              lease,
              id,
              kind,
              plan,
              (String) account.get("customer_id"),
              (String) account.get("subscription_id"),
              expires,
              ((Number) account.get("sync_revision")).longValue());
        });
  }

  @Override
  public void customer(Work work, String customer) {
    if (jdbc.update(
            "UPDATE payment_accounts SET customer_id=? WHERE user_id=? AND work_lease=? AND work_until>CURRENT_TIMESTAMP(6)",
            customer,
            work.userId().toString(),
            work.lease().toString())
        != 1) throw new BillingFailure("BILLING_LEASE_LOST");
  }

  @Override
  public void finish(Work work, String url, PaymentGateway.Snapshot snapshot) {
    transactions.executeWithoutResult(
        status -> {
          var rows =
              jdbc.queryForList(
                  "SELECT * FROM payment_accounts WHERE user_id=? AND work_lease=? AND work_until>CURRENT_TIMESTAMP(6) FOR UPDATE",
                  work.userId().toString(),
                  work.lease().toString());
          if (rows.isEmpty()) throw new BillingFailure("BILLING_LEASE_LOST");
          if (snapshot != null) sagas.reconcile(work.userId(), rows.getFirst(), snapshot);
          if (work.requestId() != null)
            jdbc.update(
                "UPDATE payment_requests SET status='SUCCEEDED',result_url=?,error_code=NULL WHERE id=?",
                url,
                work.requestId().toString());
          if (work.kind().equals("CANCEL"))
            jdbc.update(
                "UPDATE payment_accounts SET sync_revision=sync_revision+1,cancel_at_period_end=1 WHERE user_id=?",
                work.userId().toString());
          jdbc.update(
              "UPDATE payment_accounts SET work_lease=NULL,work_until=NULL,synced_revision=?,next_sync_at=IF(sync_revision>?,CURRENT_TIMESTAMP(6),TIMESTAMPADD(SECOND,300,CURRENT_TIMESTAMP(6))) WHERE user_id=?",
              work.syncRevision(),
              work.syncRevision(),
              work.userId().toString());
        });
  }

  @Override
  public void retry(Work work, String code) {
    transactions.executeWithoutResult(
        status -> {
          var rows =
              jdbc.queryForList(
                  "SELECT user_id FROM payment_accounts WHERE user_id=? AND work_lease=? FOR UPDATE",
                  work.userId().toString(),
                  work.lease().toString());
          if (rows.isEmpty()) return;
          boolean transientFailure =
              java.util.Set.of("STRIPE_UNAVAILABLE", "SAGA_BUSY", "BILLING_LEASE_LOST")
                  .contains(code);
          if (work.requestId() != null) {
            boolean expired = !work.expiresAt().isAfter(Instant.now());
            jdbc.update(
                "UPDATE payment_requests SET status=?,error_code=?,next_attempt_at=TIMESTAMPADD(SECOND,15,CURRENT_TIMESTAMP(6)) WHERE id=?",
                expired ? "REVIEW" : transientFailure ? "PENDING" : "FAILED",
                expired ? "PROVIDER_OUTCOME_REVIEW" : code,
                work.requestId().toString());
          }
          jdbc.update(
              "UPDATE payment_accounts SET work_lease=NULL,work_until=NULL,next_sync_at=TIMESTAMPADD(SECOND,15,CURRENT_TIMESTAMP(6)),review_needed=IF(?,review_needed,1),synced_revision=IF(?,synced_revision,sync_revision) WHERE user_id=?",
              transientFailure && work.expiresAt().isAfter(Instant.now()),
              transientFailure,
              work.userId().toString());
        });
  }

  @Override
  public void reply(
      UUID eventId,
      String raw,
      UUID userId,
      UUID sagaId,
      long generation,
      String phase,
      String participant,
      String outcome) {
    sagas.reply(eventId, raw, userId, sagaId, generation, phase, participant, outcome);
  }
}
