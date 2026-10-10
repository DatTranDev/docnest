package vn.editor.processing.jobs.infrastructure;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;
import vn.editor.common.observability.OperationalMetrics;
import vn.editor.common.storage.StorageProvider;
import vn.editor.processing.jobs.application.port.JobExecutionRepository;
import vn.editor.processing.jobs.domain.JobLifecyclePolicy;

/** Short SQL transactions fence every lease mutation and atomically emit completion events. */
@Repository
public class JdbcJobExecutionDao implements JobExecutionRepository {
  private final JdbcJobDao jobs;
  private final JdbcTemplate db;
  private final TransactionTemplate tx;
  private final ProcessingEvents events;

  public JdbcJobExecutionDao(
      JdbcJobDao jobs, JdbcTemplate db, TransactionTemplate tx, ProcessingEvents events) {
    this.jobs = jobs;
    this.db = db;
    this.tx = tx;
    this.events = events;
  }

  @Override
  public LeasedJob claim(Set<String> locallyActiveIds) {
    return tx.execute(
        transaction -> {
          List<Object> excluded = new ArrayList<>(locallyActiveIds);
          String exclusion =
              excluded.isEmpty()
                  ? ""
                  : " AND id NOT IN ("
                      + String.join(",", Collections.nCopies(excluded.size(), "?"))
                      + ")";
          List<Map<String, Object>> rows =
              db.queryForList(
                  "SELECT * FROM jobs WHERE deadline_at>UTC_TIMESTAMP(6) AND attempts<3 AND ((state='READY' AND next_attempt_at<=UTC_TIMESTAMP(6)) OR (state='RUNNING' AND lease_until<=UTC_TIMESTAMP(6)))"
                      + exclusion
                      + " ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
                  excluded.toArray());
          if (rows.isEmpty()) return null;
          Map<String, Object> row = rows.getFirst();
          if ("RUNNING".equals(row.get("state"))) {
            OperationalMetrics.increment(
                "processing-service", OperationalMetrics.Counter.LEASE_RECLAIM);
          }
          String owner = UUID.randomUUID().toString();
          db.update(
              "UPDATE jobs SET state='RUNNING',attempts=attempts+1,lease_owner=?,lease_until=UTC_TIMESTAMP(6)+INTERVAL 60 SECOND,started_at=COALESCE(started_at,UTC_TIMESTAMP(6)) WHERE id=?",
              owner,
              row.get("id"));
          return leased(jobs.row((String) row.get("id")));
        });
  }

  @Override
  public ExecutionState current(String id) {
    Map<String, Object> row =
        db.queryForMap(
            "SELECT state,lease_owner,lease_until,cancel_requested,deadline_at FROM jobs WHERE id=?",
            id);
    return new ExecutionState(
        (String) row.get("state"),
        (String) row.get("lease_owner"),
        JdbcJobDao.instant(row.get("lease_until")),
        Boolean.TRUE.equals(row.get("cancel_requested")),
        JdbcJobDao.instant(row.get("deadline_at")));
  }

  @Override
  public void heartbeat(String id, String owner) {
    db.update(
        "UPDATE jobs SET lease_until=UTC_TIMESTAMP(6)+INTERVAL 60 SECOND WHERE id=? AND state='RUNNING' AND lease_owner=? AND lease_until>UTC_TIMESTAMP(6)",
        id,
        owner);
  }

  @Override
  public void reserveOutput(String id, String owner, String outputKey) {
    db.update(
        "INSERT INTO output_attempts(attempt_id,job_id,output_key,state,created_at,updated_at) VALUES(?,?,?,'RESERVED',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))",
        owner,
        id,
        outputKey);
  }

  @Override
  public boolean complete(
      String id,
      String owner,
      StorageProvider.ObjectRef output,
      long bytes,
      Map<String, Object> summary) {
    return tx.execute(
        transaction -> {
          Map<String, Object> row = db.queryForMap("SELECT * FROM jobs WHERE id=? FOR UPDATE", id);
          if (!ownsLiveLease(row, owner)) return false;
          if (Boolean.TRUE.equals(row.get("cancel_requested"))) {
            terminal(row, "CANCELLED", "CANCELLED");
            return false;
          }
          if (!JdbcJobDao.instant(row.get("deadline_at")).isAfter(Instant.now())) {
            terminal(row, "FAILED", "JOB_DEADLINE");
            return false;
          }
          if (bytes > ExportRenderer.MAX_OUTPUT) {
            terminal(row, "FAILED", "EXPORT_TOO_LARGE");
            return false;
          }
          db.update(
              "UPDATE jobs SET state='SUCCEEDED',error_code=NULL,error_message=NULL,output_ref=?,output_bytes=?,summary_json=?,finished_at=UTC_TIMESTAMP(6),output_expires_at=IF(? IS NULL,NULL,UTC_TIMESTAMP(6)+INTERVAL 24 HOUR),lease_owner=NULL,lease_until=NULL WHERE id=?",
              output == null ? null : events.encode(output),
              output == null ? null : bytes,
              summary == null ? null : events.encode(summary),
              output == null ? null : output.key(),
              id);
          if (output != null) {
            db.update(
                "UPDATE output_attempts SET state='PUBLISHED',output_ref=?,updated_at=UTC_TIMESTAMP(6) WHERE attempt_id=?",
                events.encode(output),
                owner);
          }
          jobs.completed(row, "SUCCEEDED", output, summary, null);
          return true;
        });
  }

  @Override
  public void fail(
      String id, String owner, String code, boolean transientFailure, boolean cancelled) {
    tx.executeWithoutResult(
        transaction -> {
          Map<String, Object> row = db.queryForMap("SELECT * FROM jobs WHERE id=? FOR UPDATE", id);
          if (!ownsLiveLease(row, owner)) return;
          boolean cancel = cancelled || Boolean.TRUE.equals(row.get("cancel_requested"));
          int attempt = ((Number) row.get("attempts")).intValue();
          if (JobLifecyclePolicy.retryAllowed(
              transientFailure,
              cancel,
              attempt,
              JdbcJobDao.instant(row.get("deadline_at")),
              Instant.now())) {
            db.update(
                "UPDATE jobs SET state='READY',error_code=?,next_attempt_at=UTC_TIMESTAMP(6)+INTERVAL ? SECOND,lease_owner=NULL,lease_until=NULL WHERE id=?",
                code,
                JobLifecyclePolicy.retryDelaySeconds(attempt),
                id);
          } else {
            terminal(row, cancel ? "CANCELLED" : "FAILED", cancel ? "CANCELLED" : code);
          }
        });
  }

  @Override
  public void expire() {
    tx.executeWithoutResult(
        transaction -> {
          List<Map<String, Object>> rows =
              db.queryForList(
                  "SELECT * FROM jobs WHERE state IN ('QUEUED','READY','RUNNING') AND (deadline_at<=UTC_TIMESTAMP(6) OR (state='RUNNING' AND lease_until<=UTC_TIMESTAMP(6) AND attempts>=3)) ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED");
          for (Map<String, Object> row : rows) {
            String code =
                JdbcJobDao.instant(row.get("deadline_at")).isAfter(Instant.now())
                    ? "ATTEMPTS_EXHAUSTED"
                    : "JOB_DEADLINE";
            terminal(row, "FAILED", code);
          }
        });
  }

  private boolean ownsLiveLease(Map<String, Object> row, String owner) {
    return JobLifecyclePolicy.ownsLiveLease(
        (String) row.get("state"),
        owner,
        (String) row.get("lease_owner"),
        JdbcJobDao.instant(row.get("lease_until")),
        Instant.now());
  }

  private void terminal(Map<String, Object> row, String state, String code) {
    db.update(
        "UPDATE jobs SET state=?,error_code=?,finished_at=UTC_TIMESTAMP(6),lease_owner=NULL,lease_until=NULL WHERE id=?",
        state,
        code,
        row.get("id"));
    jobs.completed(row, state, null, null, code);
  }

  private LeasedJob leased(Map<String, Object> row) {
    return new LeasedJob(
        (String) row.get("id"),
        (String) row.get("document_id"),
        ((Number) row.get("document_revision")).longValue(),
        (String) row.get("job_type"),
        (String) row.get("lease_owner"),
        jobs.ref(row.get("source_ref")),
        (String) row.get("source_native_sha256"),
        (String) row.get("trace_id"));
  }
}
