package vn.editor.document.documents.infrastructure;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import vn.editor.document.documents.application.port.OutboxRepository;
import vn.editor.document.documents.domain.DeliveryRetryPolicy;
import vn.editor.document.shared.infrastructure.JdbcStore;

@Repository
public class JdbcOutbox extends JdbcStore implements OutboxRepository {
  public JdbcOutbox(JdbcTemplate db, PlatformTransactionManager manager) {
    super(db, manager);
  }

  @Override
  public Message claim(String owner) {
    return transaction(
        () -> {
          Map<String, Object> row =
              one(
                  "SELECT * FROM outbox_events WHERE published_at IS NULL ORDER BY id LIMIT 1 FOR"
                      + " UPDATE");
          if (row == null
              || timestamp(row.get("next_attempt_at")).after(now())
              || (row.get("lease_until") != null && timestamp(row.get("lease_until")).after(now())))
            return null;
          db.update(
              "UPDATE outbox_events SET lease_owner=?,lease_until=?,attempts=attempts+1 WHERE id=?",
              owner,
              Timestamp.from(Instant.now().plusSeconds(30)),
              row.get("id"));
          return new Message(
              ((Number) row.get("id")).longValue(),
              row.get("topic").toString(),
              row.get("event_key").toString(),
              row.get("payload").toString(),
              ((Number) row.get("attempts")).intValue());
        });
  }

  @Override
  public void published(long id, String owner) {
    db.update(
        "UPDATE outbox_events SET published_at=?,lease_until=NULL,last_error_code=NULL WHERE id=?"
            + " AND lease_owner=?",
        now(),
        id,
        owner);
  }

  @Override
  public void retry(long id, String owner, int attempts, String error) {
    db.update(
        "UPDATE outbox_events SET next_attempt_at=?,lease_until=NULL,last_error_code=? WHERE id=?"
            + " AND lease_owner=?",
        Timestamp.from(Instant.now().plusSeconds(DeliveryRetryPolicy.seconds(attempts))),
        error,
        id,
        owner);
  }
}
