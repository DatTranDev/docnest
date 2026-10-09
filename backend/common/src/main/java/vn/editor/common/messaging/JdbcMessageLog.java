package vn.editor.common.messaging;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

/** Technical inbox/outbox storage; the caller's mutation owns its business invariants. */
public final class JdbcMessageLog {
  public record Entry(long id, String topic, String key, String payload, UUID lease) {}

  private final JdbcTemplate jdbc;
  private final TransactionTemplate transactions;

  public JdbcMessageLog(JdbcTemplate jdbc, TransactionTemplate transactions) {
    this.jdbc = jdbc;
    this.transactions = transactions;
  }

  public boolean receive(UUID eventId, String payload, Runnable mutation) {
    String fingerprint = fingerprint(payload);
    return transactions.execute(
        status -> {
          jdbc.update(
              "INSERT INTO saga_inbox(event_id,fingerprint) VALUES(?,?) ON DUPLICATE KEY UPDATE event_id=event_id",
              eventId.toString(),
              fingerprint);
          var receipt =
              jdbc.queryForMap(
                  "SELECT fingerprint,completed FROM saga_inbox WHERE event_id=? FOR UPDATE",
                  eventId.toString());
          if (!fingerprint.equals(receipt.get("fingerprint")))
            throw new IllegalArgumentException("EVENT_ID_CONFLICT");
          if (((Number) receipt.get("completed")).intValue() == 1) return false;
          mutation.run();
          jdbc.update("UPDATE saga_inbox SET completed=1 WHERE event_id=?", eventId.toString());
          return true;
        });
  }

  /** Must run inside the same local transaction as the business mutation. */
  public void enqueue(UUID eventId, String topic, String key, String payload) {
    if (!EventSchemas.valid(topic, payload))
      throw new IllegalArgumentException("INVALID_EVENT_SCHEMA");
    jdbc.update(
        "INSERT INTO saga_outbox(event_id,topic,aggregate_key,payload) VALUES(?,?,?,?)",
        eventId.toString(),
        topic,
        key,
        payload);
  }

  public List<Entry> claim() {
    return transactions.execute(
        status -> {
          var ids =
              jdbc.query(
                  "SELECT id FROM saga_outbox WHERE published_at IS NULL AND next_attempt_at<=CURRENT_TIMESTAMP(6) AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP(6)) ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED",
                  (rs, row) -> rs.getLong(1));
          if (ids.isEmpty()) return List.of();
          long id = ids.getFirst();
          UUID lease = UUID.randomUUID();
          jdbc.update(
              "UPDATE saga_outbox SET lease_id=?,lease_until=TIMESTAMPADD(SECOND,30,CURRENT_TIMESTAMP(6)) WHERE id=?",
              lease.toString(),
              id);
          return jdbc.query(
              "SELECT topic,aggregate_key,payload FROM saga_outbox WHERE id=?",
              (rs, row) -> new Entry(id, rs.getString(1), rs.getString(2), rs.getString(3), lease),
              id);
        });
  }

  public void delivered(Entry entry) {
    jdbc.update(
        "UPDATE saga_outbox SET published_at=CURRENT_TIMESTAMP(6),lease_until=NULL,lease_id=NULL WHERE id=? AND lease_id=?",
        entry.id(),
        entry.lease().toString());
  }

  public void retry(Entry entry) {
    jdbc.update(
        "UPDATE saga_outbox SET attempts=attempts+1,next_attempt_at=TIMESTAMPADD(SECOND,LEAST(60,POW(2,LEAST(attempts,6))),CURRENT_TIMESTAMP(6)),lease_until=NULL,lease_id=NULL WHERE id=? AND lease_id=?",
        entry.id(),
        entry.lease().toString());
  }

  public static String fingerprint(String payload) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256")
                  .digest(payload.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException impossible) {
      throw new IllegalStateException("SHA256_UNAVAILABLE");
    }
  }
}
