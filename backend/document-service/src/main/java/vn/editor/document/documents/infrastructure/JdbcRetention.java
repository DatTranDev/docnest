package vn.editor.document.documents.infrastructure;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import vn.editor.document.documents.application.port.RetentionRepository;
import vn.editor.document.documents.domain.RetentionPolicy;
import vn.editor.document.shared.infrastructure.JdbcStore;

@Repository
public class JdbcRetention extends JdbcStore implements RetentionRepository {
  public JdbcRetention(JdbcTemplate db, PlatformTransactionManager manager) {
    super(db, manager);
  }

  @Override
  public List<Orphan> expiredOrphans() {
    db.update(
        "UPDATE upload_sessions SET"
            + " state='ABANDONED',validation_lease_owner=NULL,validation_lease_until=NULL WHERE"
            + " state NOT IN ('COMMITTED','ABANDONED') AND expires_at<? AND (validation_lease_until"
            + " IS NULL OR validation_lease_until<?)",
        now(),
        now());
    List<Orphan> orphans = new ArrayList<>();
    for (Map<String, Object> row :
        db.queryForList(
            "SELECT * FROM upload_sessions WHERE state='ABANDONED' AND object_deleted_at IS NULL"
                + " AND expires_at<? LIMIT 100",
            cutoff(RetentionPolicy.READ_GRACE_SECONDS))) {
      if (db.queryForObject(
              "SELECT COUNT(*) FROM document_versions WHERE object_key=?",
              Integer.class,
              row.get("object_key"))
          > 0) continue;
      orphans.add(
          new Orphan(
              row.get("id").toString(),
              (String) row.get("resumable_uri"),
              row.get("object_key").toString(),
              row.get("object_generation") == null ? null : JdbcDocuments.reference(row)));
    }
    return orphans;
  }

  @Override
  public void orphanDeleted(String id) {
    db.update(
        "UPDATE upload_sessions SET object_deleted_at=?,resumable_uri=NULL WHERE id=? AND"
            + " state='ABANDONED'",
        now(),
        id);
  }

  @Override
  public List<String> retiredCandidates() {
    return db.queryForList(
        "SELECT id FROM document_versions WHERE retired_at<? AND last_access_at<? AND"
            + " object_deleted_at IS NULL LIMIT 100",
        String.class,
        cutoff(RetentionPolicy.READ_GRACE_SECONDS),
        cutoff(RetentionPolicy.READ_GRACE_SECONDS));
  }

  @Override
  public Retired claimRetired(String id) {
    return transaction(
        () -> {
          Map<String, Object> version =
              one("SELECT * FROM document_versions WHERE id=? FOR UPDATE", id);
          if (version == null) return null;
          Map<String, Object> document =
              one("SELECT head_version_id FROM documents WHERE id=?", version.get("document_id"));
          String head = document == null ? null : (String) document.get("head_version_id");
          if (!RetentionPolicy.canDeleteVersion(
              version.get("retired_at") != null,
              version.get("object_deleted_at") != null,
              timestamp(version.get("last_access_at")).toInstant(),
              id,
              head,
              Instant.now())) return null;
          db.update("UPDATE document_versions SET cleanup_pending=TRUE WHERE id=?", id);
          return new Retired(id, JdbcDocuments.reference(version));
        });
  }

  @Override
  public void retiredDeleted(String id) {
    db.update(
        "UPDATE document_versions SET object_deleted_at=?,cleanup_pending=FALSE WHERE id=? AND"
            + " retired_at IS NOT NULL",
        now(),
        id);
  }

  @Override
  public void purgeTrash() {
    for (String id :
        db.queryForList(
            "SELECT id FROM documents WHERE deleted_at<? LIMIT 100",
            String.class,
            cutoff(RetentionPolicy.TRASH_SECONDS + RetentionPolicy.READ_GRACE_SECONDS)))
      transaction(
          () -> {
            Map<String, Object> document = one("SELECT * FROM documents WHERE id=? FOR UPDATE", id);
            if (document == null
                || document.get("deleted_at") == null
                || timestamp(document.get("deleted_at"))
                    .after(
                        cutoff(RetentionPolicy.TRASH_SECONDS + RetentionPolicy.READ_GRACE_SECONDS)))
              return null;
            if (db.queryForObject(
                    "SELECT COUNT(*) FROM document_versions WHERE document_id=? AND"
                        + " last_access_at>?",
                    Integer.class,
                    id,
                    cutoff(RetentionPolicy.READ_GRACE_SECONDS))
                > 0) return null;
            db.update("UPDATE documents SET head_revision=0,head_version_id=NULL WHERE id=?", id);
            db.update(
                "UPDATE document_versions SET retired_at=COALESCE(retired_at,?) WHERE"
                    + " document_id=?",
                now(),
                id);
            if (db.queryForObject(
                    "SELECT COUNT(*) FROM document_versions WHERE document_id=? AND"
                        + " object_deleted_at IS NULL",
                    Integer.class,
                    id)
                > 0) return null;
            if (db.queryForObject(
                    "SELECT COUNT(*) FROM upload_sessions WHERE document_id=? AND"
                        + " state<>'COMMITTED' AND object_deleted_at IS NULL",
                    Integer.class,
                    id)
                > 0) return null;
            db.update("DELETE FROM upload_sessions WHERE document_id=?", id);
            db.update("DELETE FROM share_links WHERE document_id=?", id);
            db.update("DELETE FROM document_permissions WHERE document_id=?", id);
            db.update("DELETE FROM document_versions WHERE document_id=?", id);
            db.update("DELETE FROM documents WHERE id=?", id);
            return null;
          });
  }

  @Override
  public void expireReceipts() {
    db.update("DELETE FROM idempotency_requests WHERE expires_at<?", now());
    db.update(
        "DELETE FROM outbox_events WHERE published_at<?",
        cutoff(RetentionPolicy.PUBLISHED_EVENT_SECONDS));
  }

  private static Timestamp cutoff(long seconds) {
    return Timestamp.from(Instant.now().minusSeconds(seconds));
  }
}
