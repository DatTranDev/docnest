package vn.editor.processing.jobs.infrastructure;

import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import vn.editor.processing.jobs.application.port.JobOutputCleanupRepository;

/** SQL reference/retention bookkeeping, deliberately independent of object storage IO. */
@Repository
public class JdbcJobOutputCleanupRepository implements JobOutputCleanupRepository {
  private final JdbcJobRepository jobs;
  private final JdbcTemplate db;

  public JdbcJobOutputCleanupRepository(JdbcJobRepository jobs, JdbcTemplate db) {
    this.jobs = jobs;
    this.db = db;
  }

  @Override
  public List<ExpiredResult> expiredResults() {
    return db
        .queryForList(
            "SELECT id,output_ref FROM jobs WHERE output_expires_at<UTC_TIMESTAMP(6) AND output_ref IS NOT NULL LIMIT 100")
        .stream()
        .map(row -> new ExpiredResult((String) row.get("id"), jobs.ref(row.get("output_ref"))))
        .toList();
  }

  @Override
  public void clearExpiredResult(String jobId) {
    db.update(
        "UPDATE jobs SET output_ref=NULL,output_bytes=NULL WHERE id=? AND output_expires_at<UTC_TIMESTAMP(6)",
        jobId);
  }

  @Override
  public List<OrphanAttempt> orphanCandidates() {
    return db
        .queryForList(
            "SELECT attempt_id,output_key FROM output_attempts WHERE state<>'CLEANED' AND created_at<UTC_TIMESTAMP(6)-INTERVAL 24 HOUR LIMIT 100")
        .stream()
        .map(
            row ->
                new OrphanAttempt((String) row.get("attempt_id"), (String) row.get("output_key")))
        .toList();
  }

  @Override
  public boolean isOutputReferenced(String key) {
    return db.queryForObject(
            "SELECT COUNT(*) FROM jobs WHERE output_ref IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(output_ref,'$.key'))=?",
            Integer.class,
            key)
        > 0;
  }

  @Override
  public void markAttemptCleaned(String attemptId) {
    db.update(
        "UPDATE output_attempts SET state='CLEANED',updated_at=UTC_TIMESTAMP(6) WHERE attempt_id=?",
        attemptId);
  }

  @Override
  public void retainRecentBookkeeping() {
    db.update(
        "DELETE FROM outbox_events WHERE published_at<UTC_TIMESTAMP(6)-INTERVAL 7 DAY LIMIT 1000");
    db.update("DELETE FROM idempotency_requests WHERE expires_at<UTC_TIMESTAMP(6) LIMIT 1000");
  }
}
