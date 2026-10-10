package vn.editor.identity.auth.infrastructure.persistence;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import vn.editor.identity.auth.application.port.RefreshSessionRepository;
import vn.editor.identity.auth.domain.RefreshSession;

@Repository
public class JdbcRefreshSessionDao implements RefreshSessionRepository {
  private final JdbcTemplate jdbc;

  public JdbcRefreshSessionDao(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public String findUserId(String fingerprint) {
    List<String> rows =
        jdbc.query(
            "SELECT user_id FROM refresh_sessions WHERE token_sha256=?",
            (row, index) -> row.getString("user_id"),
            fingerprint);
    return rows.isEmpty() ? null : rows.getFirst();
  }

  @Override
  public RefreshSession lockByFingerprint(String fingerprint) {
    List<Map<String, Object>> rows =
        jdbc.queryForList(
            "SELECT * FROM refresh_sessions WHERE token_sha256=? FOR UPDATE", fingerprint);
    if (rows.isEmpty()) return null;
    Map<String, Object> row = rows.getFirst();
    return new RefreshSession(
        (String) row.get("id"),
        (String) row.get("user_id"),
        (String) row.get("family_id"),
        (String) row.get("token_sha256"),
        instant(row.get("expires_at")),
        row.get("used_at") != null,
        row.get("revoked_at") != null);
  }

  @Override
  public void insert(RefreshSession session) {
    jdbc.update(
        "INSERT INTO refresh_sessions(id,user_id,family_id,token_sha256,created_at,expires_at) VALUES(?,?,?,?,UTC_TIMESTAMP(6),?)",
        session.id(),
        session.userId(),
        session.familyId(),
        session.tokenFingerprint(),
        Timestamp.from(session.expiresAt()));
  }

  @Override
  public void markUsed(String sessionId) {
    jdbc.update("UPDATE refresh_sessions SET used_at=UTC_TIMESTAMP(6) WHERE id=?", sessionId);
  }

  @Override
  public void revokeFamily(String familyId) {
    jdbc.update(
        "UPDATE refresh_sessions SET revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP(6)) WHERE family_id=?",
        familyId);
  }

  private static Instant instant(Object value) {
    return value instanceof Timestamp timestamp
        ? timestamp.toInstant()
        : ((LocalDateTime) value).toInstant(ZoneOffset.UTC);
  }
}
