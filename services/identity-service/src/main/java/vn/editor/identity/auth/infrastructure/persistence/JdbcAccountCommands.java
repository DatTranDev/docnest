package vn.editor.identity.auth.infrastructure.persistence;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import vn.editor.identity.auth.application.port.AccountCommands;
import vn.editor.identity.auth.domain.Account;
import vn.editor.identity.auth.domain.AccountEmail;
import vn.editor.identity.auth.domain.AuthenticationFailure;

@Repository
public class JdbcAccountCommands implements AccountCommands {
  private final JdbcTemplate jdbc;

  public JdbcAccountCommands(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public void lockRegistrationQuota() {
    jdbc.queryForObject(
        "SELECT singleton FROM identity_limits WHERE singleton=1 FOR UPDATE", Integer.class);
  }

  @Override
  public boolean emailExists(AccountEmail email) {
    return jdbc.queryForObject(
            "SELECT COUNT(*) FROM users WHERE email_norm=?", Long.class, email.value())
        > 0;
  }

  @Override
  public long countAccounts() {
    return jdbc.queryForObject("SELECT COUNT(*) FROM users", Long.class);
  }

  @Override
  public void insert(Account account) {
    try {
      jdbc.update(
          "INSERT INTO users(id,email_norm,password_hash,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)",
          account.id(),
          account.email().value(),
          account.passwordHash(),
          account.displayName(),
          Timestamp.from(account.createdAt()),
          Timestamp.from(account.createdAt()));
    } catch (DuplicateKeyException duplicate) {
      throw new AuthenticationFailure(
          AuthenticationFailure.Reason.EMAIL_ALREADY_REGISTERED, "Email is already registered");
    }
  }

  @Override
  public Account findByEmail(AccountEmail email) {
    List<Map<String, Object>> rows =
        jdbc.queryForList("SELECT * FROM users WHERE email_norm=?", email.value());
    return rows.isEmpty() ? null : map(rows.getFirst());
  }

  @Override
  public Account lockById(String id) {
    return map(jdbc.queryForMap("SELECT * FROM users WHERE id=? FOR UPDATE", id));
  }

  private Account map(Map<String, Object> row) {
    Object created = row.get("created_at");
    return new Account(
        (String) row.get("id"),
        new AccountEmail((String) row.get("email_norm")),
        (String) row.get("password_hash"),
        (String) row.get("display_name"),
        "ACTIVE".equals(row.get("status")),
        created instanceof Timestamp stamp
            ? stamp.toInstant()
            : ((LocalDateTime) created).toInstant(ZoneOffset.UTC));
  }
}
