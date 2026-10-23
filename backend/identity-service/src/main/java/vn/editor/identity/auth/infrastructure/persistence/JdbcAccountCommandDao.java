package vn.editor.identity.auth.infrastructure.persistence;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import vn.editor.identity.auth.application.port.AccountCommandRepository;
import vn.editor.identity.auth.domain.Account;
import vn.editor.identity.auth.domain.AccountEmail;
import vn.editor.identity.auth.domain.AuthenticationFailure;

@Repository
public class JdbcAccountCommandDao implements AccountCommandRepository {
  private final JdbcTemplate jdbc;

  public JdbcAccountCommandDao(JdbcTemplate jdbc) {
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
  public Account findByGoogleSubject(String subject) {
    List<Map<String, Object>> rows =
        jdbc.queryForList(
            "SELECT u.* FROM users u JOIN google_identities g ON g.user_id=u.id WHERE g.google_subject=?",
            subject);
    return rows.isEmpty() ? null : map(rows.getFirst());
  }

  @Override
  public void linkGoogleSubject(String subject, String userId, AccountEmail providerEmail) {
    try {
      jdbc.update(
          "INSERT INTO google_identities(google_subject,user_id,provider_email,created_at) VALUES(?,?,?,UTC_TIMESTAMP(6))",
          subject,
          userId,
          providerEmail.value());
    } catch (DuplicateKeyException collision) {
      throw new AuthenticationFailure(
          AuthenticationFailure.Reason.IDENTITY_CONFLICT, "Google identity is already linked");
    }
  }

  @Override
  public void confirmGoogleEmail(String subject, String userId, AccountEmail providerEmail) {
    jdbc.update(
        "UPDATE google_identities SET provider_email=? WHERE google_subject=? AND user_id=?",
        providerEmail.value(),
        subject,
        userId);
  }

  @Override
  public boolean hasGoogleIdentity(String userId) {
    return jdbc.queryForObject(
            "SELECT COUNT(*) FROM google_identities WHERE user_id=?", Long.class, userId)
        > 0;
  }

  @Override
  public void unlinkGoogleIdentity(String userId) {
    jdbc.update("DELETE FROM google_identities WHERE user_id=?", userId);
    jdbc.update(
        "UPDATE users SET google_picture_url=NULL,avatar_source=CASE WHEN custom_avatar IS NOT NULL THEN 'CUSTOM' ELSE 'GENERATED' END,avatar_updated_at=UTC_TIMESTAMP(6) WHERE id=?",
        userId);
  }

  @Override
  public void setPassword(String userId, String hash) {
    jdbc.update(
        "UPDATE users SET password_hash=?,updated_at=UTC_TIMESTAMP(6) WHERE id=?", hash, userId);
  }

  @Override
  public void updateGooglePicture(String userId, String pictureUrl) {
    if (pictureUrl == null || pictureUrl.length() > 1024) return;
    jdbc.update(
        "UPDATE users SET google_picture_url=?,avatar_source=CASE WHEN custom_avatar IS NOT NULL THEN 'CUSTOM' ELSE 'GOOGLE' END,avatar_updated_at=UTC_TIMESTAMP(6) WHERE id=?",
        pictureUrl,
        userId);
  }

  @Override
  public void setCustomAvatar(String userId, byte[] image, String mime) {
    jdbc.update(
        "UPDATE users SET custom_avatar=?,custom_avatar_mime=?,avatar_source='CUSTOM',avatar_updated_at=UTC_TIMESTAMP(6) WHERE id=?",
        image,
        mime,
        userId);
  }

  @Override
  public void removeCustomAvatar(String userId) {
    jdbc.update(
        "UPDATE users SET custom_avatar=NULL,custom_avatar_mime=NULL,avatar_source=CASE WHEN google_picture_url IS NOT NULL THEN 'GOOGLE' ELSE 'GENERATED' END,avatar_updated_at=UTC_TIMESTAMP(6) WHERE id=?",
        userId);
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
            : ((LocalDateTime) created).toInstant(ZoneOffset.UTC),
        (String) row.get("avatar_source"),
        avatarUrl(row));
  }

  private String avatarUrl(Map<String, Object> row) {
    String source = (String) row.get("avatar_source");
    if ("CUSTOM".equals(source))
      return "/api/v1/avatars/"
          + row.get("id")
          + "?v="
          + row.get("avatar_updated_at").toString().replaceAll("[^0-9]", "");
    return "GOOGLE".equals(source) ? (String) row.get("google_picture_url") : null;
  }
}
