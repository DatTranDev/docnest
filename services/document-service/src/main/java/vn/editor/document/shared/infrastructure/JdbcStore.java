package vn.editor.document.shared.infrastructure;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vn.editor.document.shared.domain.DomainException;

public abstract class JdbcStore {
  public final JdbcTemplate db;
  public final TransactionTemplate tx;
  public final ObjectMapper json = new ObjectMapper();

  protected JdbcStore(JdbcTemplate db, PlatformTransactionManager manager) {
    this.db = db;
    this.tx = new TransactionTemplate(manager);
  }

  public <T> T transaction(Supplier<T> action) {
    for (int attempt = 0; ; attempt++) {
      try {
        return tx.execute(s -> action.get());
      } catch (org.springframework.dao.PessimisticLockingFailureException ex) {
        if (attempt >= 2) throw new DomainException(503, "TRANSACTION_RETRY");
        try {
          Thread.sleep(20L * (attempt + 1));
        } catch (InterruptedException interrupted) {
          Thread.currentThread().interrupt();
          throw new DomainException(503, "TRANSACTION_RETRY");
        }
      }
    }
  }

  public static Timestamp now() {
    return Timestamp.from(Instant.now());
  }

  public static String uuid() {
    return UUID.randomUUID().toString();
  }

  public String encode(Object value) {
    try {
      return json.writeValueAsString(value);
    } catch (IOException ex) {
      throw new IllegalStateException(ex);
    }
  }

  public Map<String, Object> parse(String value) {
    try {
      return json.readValue(value, Map.class);
    } catch (IOException ex) {
      throw new IllegalStateException(ex);
    }
  }

  protected static Timestamp timestamp(Object value) {
    return value instanceof LocalDateTime date
        ? Timestamp.from(date.toInstant(ZoneOffset.UTC))
        : (Timestamp) value;
  }

  protected static String time(Object value) {
    return value == null ? null : timestamp(value).toInstant().toString();
  }

  public Map<String, Object> one(String sql, Object... args) {
    List<Map<String, Object>> rows = db.queryForList(sql, args);
    if (rows.isEmpty()) return null;
    Map<String, Object> r = rows.getFirst();
    r.replaceAll((k, v) -> v instanceof LocalDateTime ? timestamp(v) : v);
    return r;
  }
}
