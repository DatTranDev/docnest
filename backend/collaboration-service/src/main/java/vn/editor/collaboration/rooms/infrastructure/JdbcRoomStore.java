package vn.editor.collaboration.rooms.infrastructure;

import java.security.MessageDigest;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;
import vn.editor.collaboration.rooms.application.port.RoomStore;
import vn.editor.collaboration.rooms.domain.RoomFailure;
import vn.editor.collaboration.rooms.domain.RoomPolicy;

@Repository
public class JdbcRoomStore implements RoomStore {
  private final JdbcTemplate jdbc;
  private final TransactionTemplate transactions;

  public JdbcRoomStore(JdbcTemplate jdbc, TransactionTemplate transactions) {
    this.jdbc = jdbc;
    this.transactions = transactions;
  }

  @Override
  public Page join(UUID id, long headRevision, byte[] seed) {
    RoomPolicy.update(seed);
    transactions.executeWithoutResult(
        status -> {
          jdbc.update(
              "INSERT INTO collaboration_rooms(document_id,head_revision,sequence,log_bytes) VALUES(?,?,0,0) ON DUPLICATE KEY UPDATE document_id=document_id",
              id.toString(),
              headRevision);
          Long sequence =
              jdbc.queryForObject(
                  "SELECT sequence FROM collaboration_rooms WHERE document_id=? FOR UPDATE",
                  Long.class,
                  id.toString());
          if (sequence != null && sequence == 0) {
            jdbc.update(
                "INSERT INTO collaboration_updates(document_id,sequence,operation_id,user_id,payload) VALUES(?,1,?,?,?)",
                id.toString(),
                UUID.randomUUID().toString(),
                new UUID(0, 0).toString(),
                seed);
            jdbc.update(
                "UPDATE collaboration_rooms SET sequence=1,log_bytes=? WHERE document_id=?",
                seed.length,
                id.toString());
          }
        });
    return read(id, 0);
  }

  @Override
  public Page read(UUID id, long after) {
    return transactions.execute(
        status -> {
          var headers =
              jdbc.query(
                  "SELECT head_revision,sequence FROM collaboration_rooms WHERE document_id=?",
                  (rs, row) -> new long[] {rs.getLong(1), rs.getLong(2)},
                  id.toString());
          if (headers.isEmpty()) throw new RoomFailure("COLLABORATION_NOT_FOUND");
          long[] header = headers.getFirst();
          // A byte budget prevents 100 maximum-sized updates accumulating in RAM.
          List<Update> updates =
              jdbc.query(
                  "SELECT sequence,operation_id,payload FROM collaboration_updates WHERE document_id=? AND sequence>? AND sequence<=? ORDER BY sequence LIMIT 1",
                  (rs, row) ->
                      new Update(rs.getLong(1), UUID.fromString(rs.getString(2)), rs.getBytes(3)),
                  id.toString(),
                  after,
                  header[1]);
          return new Page(header[0], header[1], updates);
        });
  }

  @Override
  public long append(UUID id, UUID operationId, UUID userId, byte[] payload) {
    RoomPolicy.update(payload);
    return transactions.execute(
        status -> {
          var rooms =
              jdbc.query(
                  "SELECT sequence,log_bytes FROM collaboration_rooms WHERE document_id=? FOR UPDATE",
                  (rs, row) -> new long[] {rs.getLong(1), rs.getLong(2)},
                  id.toString());
          if (rooms.isEmpty()) throw new RoomFailure("COLLABORATION_NOT_FOUND");
          if (Boolean.TRUE.equals(
              jdbc.queryForObject(
                  "SELECT checkpoint_until > CURRENT_TIMESTAMP(6) FROM collaboration_rooms WHERE document_id=?",
                  Boolean.class,
                  id.toString()))) throw new RoomFailure("COLLABORATION_CHECKPOINT_BUSY");
          var prior =
              jdbc.query(
                  "SELECT sequence,user_id,payload FROM collaboration_updates WHERE document_id=? AND operation_id=?",
                  (rs, row) -> {
                    if (!userId.toString().equals(rs.getString(2))
                        || !MessageDigest.isEqual(payload, rs.getBytes(3)))
                      throw new RoomFailure("COLLABORATION_IDEMPOTENCY_CONFLICT");
                    return rs.getLong(1);
                  },
                  id.toString(),
                  operationId.toString());
          if (!prior.isEmpty()) return prior.getFirst();
          var room = rooms.getFirst();
          RoomPolicy.append(room[1], room[0], payload.length);
          long next = room[0] + 1;
          jdbc.update(
              "INSERT INTO collaboration_updates(document_id,sequence,operation_id,user_id,payload) VALUES(?,?,?,?,?)",
              id.toString(),
              next,
              operationId.toString(),
              userId.toString(),
              payload);
          jdbc.update(
              "UPDATE collaboration_rooms SET sequence=?,log_bytes=log_bytes+? WHERE document_id=?",
              next,
              payload.length,
              id.toString());
          return next;
        });
  }

  @Override
  public long reserveCheckpoint(UUID id, long sequence, UUID lease) {
    return transactions.execute(
        status -> {
          var rooms =
              jdbc.query(
                  "SELECT head_revision,sequence,checkpoint_until > CURRENT_TIMESTAMP(6) FROM collaboration_rooms WHERE document_id=? FOR UPDATE",
                  (rs, row) -> new long[] {rs.getLong(1), rs.getLong(2), rs.getBoolean(3) ? 1 : 0},
                  id.toString());
          if (rooms.isEmpty()) throw new RoomFailure("COLLABORATION_NOT_FOUND");
          var room = rooms.getFirst();
          if (room[2] == 1 || room[1] != sequence)
            throw new RoomFailure("COLLABORATION_CHECKPOINT_BUSY");
          jdbc.update(
              "UPDATE collaboration_rooms SET checkpoint_id=?,checkpoint_until=TIMESTAMPADD(SECOND,120,CURRENT_TIMESTAMP(6)) WHERE document_id=?",
              lease.toString(),
              id.toString());
          return room[0];
        });
  }

  @Override
  public void finishCheckpoint(UUID id, UUID lease, long revision) {
    if (jdbc.update(
            "UPDATE collaboration_rooms SET head_revision=?,checkpoint_id=NULL,checkpoint_until=NULL WHERE document_id=? AND checkpoint_id=?",
            revision,
            id.toString(),
            lease.toString())
        != 1) throw new RoomFailure("COLLABORATION_CHECKPOINT_BUSY");
  }

  @Override
  public void releaseCheckpoint(UUID id, UUID lease) {
    jdbc.update(
        "UPDATE collaboration_rooms SET checkpoint_id=NULL,checkpoint_until=NULL WHERE document_id=? AND checkpoint_id=?",
        id.toString(),
        lease.toString());
  }
}
