package vn.editor.payment.billing.infrastructure;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.mysql.MySQLContainer;
import vn.editor.common.messaging.JdbcMessageLog;
import vn.editor.common.messaging.MessageEnvelope;
import vn.editor.payment.billing.application.port.PaymentGateway;
import vn.editor.payment.billing.domain.BillingFailure;

@Testcontainers
class JdbcPaymentStoreTest {
  @Container static MySQLContainer mysql = new MySQLContainer("mysql:8.4.7");
  JdbcTemplate jdbc;
  TransactionTemplate transactions;
  JdbcMessageLog messages;
  JdbcPaymentStore store;

  @BeforeEach
  void setup() {
    var source =
        new DriverManagerDataSource(mysql.getJdbcUrl(), mysql.getUsername(), mysql.getPassword());
    Flyway.configure().dataSource(source).load().migrate();
    jdbc = new JdbcTemplate(source);
    for (String table :
        List.of(
            "payment_requests",
            "payment_sagas",
            "stripe_receipts",
            "saga_outbox",
            "saga_inbox",
            "payment_accounts")) jdbc.update("DELETE FROM " + table);
    transactions = new TransactionTemplate(new DataSourceTransactionManager(source));
    messages = new JdbcMessageLog(jdbc, transactions);
    store = new JdbcPaymentStore(jdbc, transactions, new SagaTransactions(jdbc, messages));
  }

  private void reply(
      UUID user, UUID saga, long generation, String phase, String participant, String outcome) {
    UUID event = UUID.randomUUID();
    String raw =
        MessageEnvelope.encode(
            event,
            "EntitlementCompleted",
            participant + "-service",
            "1".repeat(32),
            Map.of(
                "userId",
                user.toString(),
                "sagaId",
                saga.toString(),
                "generation",
                generation,
                "phase",
                phase,
                "participant",
                participant,
                "outcome",
                outcome,
                "reason",
                outcome.equals("APPLIED") ? "NONE" : "ACCOUNT_INACTIVE"));
    store.reply(event, raw, user, saga, generation, phase, participant, outcome);
    store.reply(event, raw, user, saga, generation, phase, participant, outcome);
  }

  @Test
  void concurrentRequestsAreIdempotentPrivateAndPersistAcrossRepositoryRestart() throws Exception {
    UUID user = UUID.randomUUID(), key = UUID.randomUUID();
    try (var executor = Executors.newFixedThreadPool(8)) {
      var calls = new ArrayList<Callable<Map<String, Object>>>();
      for (int i = 0; i < 16; i++)
        calls.add(() -> store.enqueue(user, key, "CHECKOUT", "PRO_MONTHLY"));
      var results = executor.invokeAll(calls);
      Object id = results.getFirst().get().get("id");
      for (var result : results) assertEquals(id, result.get().get("id"));
      assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM payment_requests", Integer.class));
      assertThrows(BillingFailure.class, () -> store.enqueue(user, key, "CHECKOUT", "PRO_YEARLY"));
      UUID request = UUID.fromString(id.toString());
      assertThrows(BillingFailure.class, () -> store.request(UUID.randomUUID(), request));
      var restarted =
          new JdbcPaymentStore(jdbc, transactions, new SagaTransactions(jdbc, messages));
      assertEquals("PENDING", restarted.request(user, request).get("status"));
    }
  }

  @Test
  void fourRepliesCompleteSagaAndLateRepliesCannotResurrectCompensation() {
    UUID user = UUID.randomUUID();
    UUID request =
        UUID.fromString(
            store.enqueue(user, UUID.randomUUID(), "CHECKOUT", "PRO_MONTHLY").get("id").toString());
    var work = store.claim();
    assertEquals(user, work.userId());
    store.customer(work, "cus_contract");
    Instant expires = Instant.now().plusSeconds(3600).truncatedTo(ChronoUnit.SECONDS);
    store.finish(
        work,
        null,
        new PaymentGateway.Snapshot(
            "sub_contract", "PRO_MONTHLY", expires, "active", false, request));
    UUID saga = UUID.fromString(store.subscription(user).get("sagaId").toString());
    assertEquals(4, jdbc.queryForObject("SELECT COUNT(*) FROM saga_outbox", Integer.class));
    for (String participant : List.of("document", "processing", "collaboration"))
      reply(user, saga, 1, "APPLY", participant, "APPLIED");
    assertEquals("FREE", store.subscription(user).get("plan"));
    reply(user, saga, 1, "APPLY", "identity", "REJECTED");
    assertEquals(8, jdbc.queryForObject("SELECT COUNT(*) FROM saga_outbox", Integer.class));
    assertEquals(
        1,
        jdbc.queryForObject(
            "SELECT COUNT(*) FROM payment_requests WHERE kind='CANCEL'", Integer.class));
    reply(user, saga, 1, "APPLY", "identity", "APPLIED");
    assertEquals(
        0,
        jdbc.queryForObject(
            "SELECT replies FROM payment_sagas WHERE id=?", Integer.class, saga.toString()));
    for (String participant : List.of("identity", "document", "processing", "collaboration"))
      reply(user, saga, 2, "COMPENSATE", participant, "APPLIED");
    assertEquals("MANUAL_REVIEW", store.subscription(user).get("state"));
    assertEquals("FREE", store.subscription(user).get("plan"));
    assertEquals(
        2L,
        jdbc.queryForObject(
            "SELECT generation FROM payment_accounts WHERE user_id=?",
            Long.class,
            user.toString()));
  }

  @Test
  void successfulSagaAndExpiredLeaseAreFencedAndInboxOutboxRollbackTogether() {
    UUID user = UUID.randomUUID();
    UUID id =
        UUID.fromString(
            store.enqueue(user, UUID.randomUUID(), "CHECKOUT", "PRO_YEARLY").get("id").toString());
    var work = store.claim();
    store.customer(work, "cus_contract2");
    store.finish(
        work,
        null,
        new PaymentGateway.Snapshot(
            "sub_contract2",
            "PRO_YEARLY",
            Instant.now().plusSeconds(3600).truncatedTo(ChronoUnit.SECONDS),
            "active",
            true,
            id));
    UUID saga = UUID.fromString(store.subscription(user).get("sagaId").toString());
    for (String participant : List.of("identity", "document", "processing", "collaboration"))
      reply(user, saga, 1, "APPLY", participant, "APPLIED");
    assertEquals("PRO_YEARLY", store.subscription(user).get("plan"));
    assertEquals("COMPLETE", store.subscription(user).get("state"));
    assertThrows(
        BillingFailure.class, () -> store.finish(work, "https://checkout.stripe.com/stale", null));
    UUID receipt = UUID.randomUUID();
    int count = jdbc.queryForObject("SELECT COUNT(*) FROM saga_inbox", Integer.class);
    int outboxCount = jdbc.queryForObject("SELECT COUNT(*) FROM saga_outbox", Integer.class);
    assertThrows(
        IllegalStateException.class,
        () ->
            messages.receive(
                receipt,
                "bounded-contract",
                () -> {
                  jdbc.update(
                      "UPDATE payment_accounts SET plan='FREE' WHERE user_id=?", user.toString());
                  UUID event = UUID.randomUUID();
                  messages.enqueue(
                      event,
                      "billing.identity.reply.v1",
                      user.toString(),
                      MessageEnvelope.encode(
                          event,
                          "EntitlementCompleted",
                          "identity-service",
                          "1".repeat(32),
                          Map.of(
                              "userId",
                              user.toString(),
                              "sagaId",
                              saga.toString(),
                              "generation",
                              1,
                              "phase",
                              "APPLY",
                              "participant",
                              "identity",
                              "outcome",
                              "APPLIED",
                              "reason",
                              "NONE")));
                  throw new IllegalStateException("transaction-rollback");
                }));
    assertEquals("PRO_YEARLY", store.subscription(user).get("plan"));
    assertEquals(count, jdbc.queryForObject("SELECT COUNT(*) FROM saga_inbox", Integer.class));
    assertEquals(
        outboxCount, jdbc.queryForObject("SELECT COUNT(*) FROM saga_outbox", Integer.class));
    assertTrue(messages.receive(receipt, "same-contract", () -> {}));
    assertThrows(
        IllegalArgumentException.class,
        () -> messages.receive(receipt, "different-contract", () -> {}));
    assertNull(store.claim());
  }

  @Test
  void recoveryRepublishesOnlyCurrentUnfinishedPhaseWithStableEventIds() {
    UUID user = UUID.randomUUID();
    UUID id =
        UUID.fromString(
            store.enqueue(user, UUID.randomUUID(), "CHECKOUT", "PRO_MONTHLY").get("id").toString());
    var work = store.claim();
    store.customer(work, "cus_recovery");
    store.finish(
        work,
        null,
        new PaymentGateway.Snapshot(
            "sub_recovery",
            "PRO_MONTHLY",
            Instant.now().plusSeconds(3600).truncatedTo(ChronoUnit.SECONDS),
            "active",
            false,
            id));
    UUID saga = UUID.fromString(store.subscription(user).get("sagaId").toString());
    var events = jdbc.queryForList("SELECT event_id,payload FROM saga_outbox ORDER BY id");
    jdbc.update("UPDATE saga_outbox SET published_at=CURRENT_TIMESTAMP(6)");
    new SagaTransactions(jdbc, messages).recover();
    assertEquals(
        4,
        jdbc.queryForObject(
            "SELECT COUNT(*) FROM saga_outbox WHERE published_at IS NULL", Integer.class));
    assertEquals(events, jdbc.queryForList("SELECT event_id,payload FROM saga_outbox ORDER BY id"));
    for (String participant : List.of("identity", "document", "processing", "collaboration"))
      reply(user, saga, 1, "APPLY", participant, "APPLIED");
    jdbc.update("UPDATE saga_outbox SET published_at=CURRENT_TIMESTAMP(6)");
    new SagaTransactions(jdbc, messages).recover();
    assertEquals(
        0,
        jdbc.queryForObject(
            "SELECT COUNT(*) FROM saga_outbox WHERE published_at IS NULL", Integer.class));
  }

  @Test
  void webhookDuplicateAndConflictDoNotOverwriteDurableReceipts() {
    UUID user = UUID.randomUUID();
    store.enqueue(user, UUID.randomUUID(), "PORTAL", "FREE");
    var work = store.claim();
    store.customer(work, "cus_webhook");
    store.finish(work, "https://billing.stripe.com/p/test", null);
    String hash = "a".repeat(64);
    store.receipt("evt_contract", hash, "invoice.paid", "cus_webhook");
    store.receipt("evt_contract", hash, "invoice.paid", "cus_webhook");
    assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM stripe_receipts", Integer.class));
    assertThrows(
        BillingFailure.class,
        () -> store.receipt("evt_contract", "b".repeat(64), "invoice.paid", "cus_webhook"));
    assertEquals(
        hash, jdbc.queryForObject("SELECT fingerprint FROM stripe_receipts", String.class));
    assertEquals(
        2L,
        jdbc.queryForObject(
            "SELECT sync_revision FROM payment_accounts WHERE user_id=?",
            Long.class,
            user.toString()));
  }

  @Test
  void unknownExpiredProviderOutcomeBlocksNewCustomerCreationUntilManualRepair() {
    UUID user = UUID.randomUUID();
    store.enqueue(user, UUID.randomUUID(), "CHECKOUT", "PRO_MONTHLY");
    jdbc.update(
        "UPDATE payment_requests SET expires_at=TIMESTAMPADD(SECOND,-1,CURRENT_TIMESTAMP(6))");
    var work = store.claim();
    store.retry(work, "BILLING_REQUEST_EXPIRED");
    assertEquals("REVIEW", store.request(user, work.requestId()).get("status"));
    assertEquals("MANUAL_REVIEW", store.subscription(user).get("state"));
    assertEquals(
        "BILLING_REVIEW_REQUIRED",
        assertThrows(
                BillingFailure.class,
                () -> store.enqueue(user, UUID.randomUUID(), "PORTAL", "FREE"))
            .getMessage());
    assertEquals(
        "BILLING_REVIEW_REQUIRED",
        assertThrows(
                BillingFailure.class, () -> store.enqueue(user, UUID.randomUUID(), "SYNC", "FREE"))
            .getMessage());
    assertNull(store.claim());
  }
}
