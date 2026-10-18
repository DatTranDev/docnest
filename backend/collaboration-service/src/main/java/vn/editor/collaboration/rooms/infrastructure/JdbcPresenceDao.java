package vn.editor.collaboration.rooms.infrastructure;

import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Repository;
import vn.editor.collaboration.rooms.application.port.PresenceRepository;

@Repository
public final class JdbcPresenceDao implements PresenceRepository {
  private final JdbcTemplate jdbc;

  public JdbcPresenceDao(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public void heartbeat(
      UUID documentId, UUID sessionId, UUID userId, Integer anchor, Integer head) {
    jdbc.update(
        "INSERT INTO collaboration_presence(document_id,session_id,user_id,anchor_offset,head_offset,expires_at) VALUES(?,?,?,?,?,TIMESTAMPADD(SECOND,15,UTC_TIMESTAMP(6))) ON DUPLICATE KEY UPDATE anchor_offset=VALUES(anchor_offset),head_offset=VALUES(head_offset),expires_at=VALUES(expires_at)",
        documentId.toString(),
        sessionId.toString(),
        userId.toString(),
        anchor,
        head);
  }

  @Override
  public List<Member> list(UUID documentId) {
    return jdbc.query(
        "SELECT user_id,session_id,anchor_offset,head_offset FROM collaboration_presence WHERE document_id=? AND expires_at>UTC_TIMESTAMP(6) ORDER BY user_id,session_id",
        (row, index) ->
            new Member(
                UUID.fromString(row.getString(1)),
                UUID.fromString(row.getString(2)),
                row.getObject(3, Integer.class),
                row.getObject(4, Integer.class)),
        documentId.toString());
  }

  @Override
  public void leave(UUID documentId, UUID sessionId, UUID userId) {
    jdbc.update(
        "DELETE FROM collaboration_presence WHERE document_id=? AND session_id=? AND user_id=?",
        documentId.toString(),
        sessionId.toString(),
        userId.toString());
  }

  @Scheduled(fixedDelay = 60_000)
  public void expire() {
    jdbc.update("DELETE FROM collaboration_presence WHERE expires_at<=UTC_TIMESTAMP(6)");
  }
}
