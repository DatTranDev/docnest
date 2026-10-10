package vn.editor.processing.jobs.infrastructure;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;
import vn.editor.common.observability.TraceContext;
import vn.editor.common.storage.StorageProvider;
import vn.editor.processing.jobs.application.JobFailure;
import vn.editor.processing.jobs.application.port.JobCommandRepository;
import vn.editor.processing.jobs.application.port.JobReadRepository;
import vn.editor.processing.jobs.application.port.SourceSnapshot;
import vn.editor.processing.jobs.application.query.JobDetails;
import vn.editor.processing.jobs.application.query.JobPage;
import vn.editor.processing.jobs.application.query.JobView;
import vn.editor.processing.jobs.domain.ExportRequest;
import vn.editor.processing.jobs.domain.JobLifecyclePolicy;
import vn.editor.processing.jobs.domain.JobPolicyViolation;
import vn.editor.processing.jobs.domain.JobQuotaPolicy;

@Repository
public class JdbcJobDao implements JobCommandRepository, JobReadRepository {
  private final JdbcTemplate db;
  private final TransactionTemplate tx;
  private final ProcessingEvents events;
  private final ObjectMapper json;
  private final int maxJobs;

  public JdbcJobDao(
      JdbcTemplate db,
      TransactionTemplate tx,
      ProcessingEvents events,
      ObjectMapper json,
      @Value("${editor.processing.max-active-jobs}") int maxJobs) {
    this.db = db;
    this.tx = tx;
    this.events = events;
    this.json = json;
    this.maxJobs = maxJobs;
  }

  public Map<String, Object> create(
      String actor, String key, ExportRequest request, SourceSnapshot snapshot) {
    String document = request.documentId(),
        hash = request.bodyHash(),
        nativeHash = snapshot.nativeSha256(),
        source = snapshot.referenceJson();
    return tx.execute(
        t -> {
          db.update(
              "INSERT INTO requester_queues(requester_user_id,created_at) VALUES(?,UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE requester_user_id=requester_user_id",
              actor);
          db.queryForObject(
              "SELECT requester_user_id FROM requester_queues WHERE requester_user_id=? FOR UPDATE",
              String.class,
              actor);
          Map<String, Object> again = idempotent(actor, key, hash);
          if (again != null) return again;
          Long active =
              db.queryForObject(
                  "SELECT COUNT(*) FROM jobs WHERE requested_by_user_id=? AND system_job=FALSE AND state IN ('QUEUED','READY','RUNNING')",
                  Long.class,
                  actor);
          try {
            JobQuotaPolicy.requireCapacity(active, maxJobs);
          } catch (JobPolicyViolation e) {
            throw new JobFailure(429, e.code(), e.getMessage());
          }
          String id = UUID.randomUUID().toString();
          insert(
              id,
              document,
              request.revision(),
              actor,
              request.type(),
              false,
              null,
              "QUEUED",
              source,
              nativeHash);
          events.insert(
              db,
              "processing.job.requested.v1",
              document,
              request.revision(),
              events.envelope(
                  "JobRequested",
                  Map.of("jobId", id, "documentId", document, "revision", request.revision())));
          Map<String, Object> response = view(row(id));
          db.update(
              "INSERT INTO idempotency_requests(actor_user_id,operation_key,idempotency_key,request_sha256,response_status,response_body,created_at,expires_at) VALUES(?,'create-job',?,?,202,?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6)+INTERVAL 24 HOUR)",
              actor,
              key,
              hash,
              events.encode(response));
          return response;
        });
  }

  public JobView cancel(String actor, String id) {
    owned(actor, id);
    return asView(cancelSql(id));
  }

  private Map<String, Object> cancelSql(String id) {
    return tx.execute(
        t -> {
          Map<String, Object> row = db.queryForMap("SELECT * FROM jobs WHERE id=? FOR UPDATE", id);
          String state = (String) row.get("state");
          if (JobLifecyclePolicy.terminal(state))
            throw new JobFailure(409, "JOB_TERMINAL", "Job has already finished");
          if (state.equals("RUNNING")) {
            db.update("UPDATE jobs SET cancel_requested=TRUE WHERE id=?", id);
          } else {
            db.update(
                "UPDATE jobs SET state='CANCELLED',cancel_requested=TRUE,error_code='CANCELLED',finished_at=UTC_TIMESTAMP(6) WHERE id=?",
                id);
            completed(row, "CANCELLED", null, null, "CANCELLED");
          }
          return view(row(id));
        });
  }

  public JobDetails ownedDetails(String actor, String id) {
    Map<String, Object> r = owned(actor, id);
    return new JobDetails(
        asView(view(r)),
        r.get("output_ref") == null ? null : ref(r.get("output_ref")),
        r.get("output_bytes") == null ? 0 : ((Number) r.get("output_bytes")).longValue(),
        r.get("output_expires_at") == null ? null : instant(r.get("output_expires_at")));
  }

  public JobPage listOwned(String actor, int limit, String cursor) {
    Map<String, Object> page = listSql(actor, limit, cursor);
    return new JobPage(
        ((List<Map<String, Object>>) page.get("items")).stream().map(this::asView).toList(),
        (String) page.get("nextCursor"));
  }

  private Map<String, Object> listSql(String actor, int limit, String cursor) {
    if (limit < 1 || limit > 100) throw new IllegalArgumentException();
    String clause = "";
    List<Object> args = new ArrayList<>();
    args.add(actor);
    if (cursor != null) {
      Map<String, Object> c;
      try {
        c = json.readValue(Base64.getUrlDecoder().decode(cursor), Map.class);
        String id = UUID.fromString((String) c.get("id")).toString();
        Timestamp at = Timestamp.from(Instant.parse((String) c.get("createdAt")));
        clause = " AND (created_at<? OR (created_at=? AND id<?))";
        args.add(at);
        args.add(at);
        args.add(id);
      } catch (Exception e) {
        throw new IllegalArgumentException();
      }
    }
    args.add(limit + 1);
    List<Map<String, Object>> rows =
        db.queryForList(
            "SELECT * FROM jobs WHERE requested_by_user_id=? AND system_job=FALSE"
                + clause
                + " ORDER BY created_at DESC,id DESC LIMIT ?",
            args.toArray());
    boolean more = rows.size() > limit;
    if (more) rows = rows.subList(0, limit);
    List<Map<String, Object>> items = new ArrayList<>();
    for (var r : rows) {
      items.add(view(r));
    }
    String next = null;
    if (more) {
      Map<String, Object> last = rows.getLast();
      next =
          Base64.getUrlEncoder()
              .withoutPadding()
              .encodeToString(
                  events
                      .encode(
                          Map.of(
                              "id",
                              last.get("id"),
                              "createdAt",
                              instant(last.get("created_at")).toString()))
                      .getBytes(StandardCharsets.UTF_8));
    }
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("items", items);
    result.put("nextCursor", next);
    return result;
  }

  private JobView asView(Map<String, Object> v) {
    return json.convertValue(v, JobView.class);
  }

  public Map<String, Object> idempotent(String actor, String key, String hash) {
    List<Map<String, Object>> found =
        db.queryForList(
            "SELECT request_sha256,response_body FROM idempotency_requests WHERE actor_user_id=? AND operation_key='create-job' AND idempotency_key=? AND expires_at>UTC_TIMESTAMP(6)",
            actor,
            key);
    if (found.isEmpty()) return null;
    Map<String, Object> prior = found.getFirst();
    if (!hash.equals(prior.get("request_sha256")))
      throw new JobFailure(
          409, "IDEMPOTENCY_KEY_REUSED", "Use the same key only for the same request");
    return parse(prior.get("response_body"));
  }

  void insert(
      String id,
      String document,
      long revision,
      String requester,
      String type,
      boolean system,
      String dedup,
      String state,
      String source,
      String hash) {
    db.update(
        "INSERT INTO jobs(id,document_id,document_revision,requested_by_user_id,job_type,system_job,preview_dedup_key,state,source_ref,source_native_sha256,next_attempt_at,created_at,deadline_at,trace_id) VALUES(?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6),UTC_TIMESTAMP(6)+INTERVAL 15 MINUTE,?)",
        id,
        document,
        revision,
        requester,
        type,
        system,
        dedup,
        state,
        source,
        hash,
        TraceContext.traceId());
  }

  public void documentSaved(Map<String, Object> event) {
    try (TraceContext.Scope scope = TraceContext.open((String) event.get("traceId"), null)) {
      Map<String, Object> p = (Map<String, Object>) event.get("payload");
      tx.executeWithoutResult(
          t -> {
            int receipt =
                db.update(
                    "INSERT IGNORE INTO inbox_receipts(consumer_name,event_id,received_at) VALUES('processing-preview-v1',?,UTC_TIMESTAMP(6))",
                    event.get("eventId"));
            if (receipt == 0) return;
            String dedup = p.get("documentId") + ":" + p.get("revision") + ":PREVIEW";
            if (db.queryForObject(
                    "SELECT COUNT(*) FROM jobs WHERE preview_dedup_key=?", Integer.class, dedup)
                > 0) return;
            insert(
                UUID.randomUUID().toString(),
                (String) p.get("documentId"),
                ((Number) p.get("revision")).longValue(),
                (String) p.get("ownerUserId"),
                "PREVIEW",
                true,
                dedup,
                "READY",
                events.encode(p.get("objectRef")),
                (String) p.get("nativeSha256"));
          });
    }
  }

  public void requested(Map<String, Object> event) {
    Map<String, Object> p = (Map<String, Object>) event.get("payload");
    tx.executeWithoutResult(
        t -> {
          int receipt =
              db.update(
                  "INSERT IGNORE INTO inbox_receipts(consumer_name,event_id,received_at) VALUES('processing-dispatch-v1',?,UTC_TIMESTAMP(6))",
                  event.get("eventId"));
          if (receipt == 0) return;
          int changed =
              db.update(
                  "UPDATE jobs SET state='READY',next_attempt_at=UTC_TIMESTAMP(6) WHERE id=? AND document_id=? AND document_revision=? AND state='QUEUED'",
                  p.get("jobId"),
                  p.get("documentId"),
                  p.get("revision"));
          if (changed == 0
              && db.queryForObject(
                      "SELECT COUNT(*) FROM jobs WHERE id=?", Integer.class, p.get("jobId"))
                  == 0) throw new IllegalStateException("Job not yet visible");
        });
  }

  private Map<String, Object> owned(String actor, String id) {
    List<Map<String, Object>> rows =
        db.queryForList(
            "SELECT * FROM jobs WHERE id=? AND requested_by_user_id=? AND system_job=FALSE",
            UUID.fromString(id).toString(),
            actor);
    if (rows.isEmpty()) throw new JobFailure(404, "JOB_NOT_FOUND", "Job is unavailable");
    return rows.getFirst();
  }

  Map<String, Object> row(String id) {
    return db.queryForMap("SELECT * FROM jobs WHERE id=?", id);
  }

  Map<String, Object> view(Map<String, Object> r) {
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("id", r.get("id"));
    result.put("documentId", r.get("document_id"));
    result.put("revision", r.get("document_revision"));
    result.put("type", r.get("job_type"));
    result.put("state", r.get("state"));
    result.put("attempts", r.get("attempts"));
    result.put("createdAt", instant(r.get("created_at")).toString());
    result.put(
        "finishedAt",
        r.get("finished_at") == null ? null : instant(r.get("finished_at")).toString());
    result.put("errorCode", r.get("error_code"));
    return result;
  }

  void completed(
      Map<String, Object> r,
      String state,
      StorageProvider.ObjectRef output,
      Map<String, Object> summary,
      String code) {
    try (TraceContext.Scope scope = TraceContext.open((String) r.get("trace_id"), null)) {
      Map<String, Object> payload = new LinkedHashMap<>();
      payload.put("jobId", r.get("id"));
      payload.put("documentId", r.get("document_id"));
      payload.put("revision", r.get("document_revision"));
      payload.put("type", r.get("job_type"));
      payload.put("state", state);
      payload.put("requestedByUserId", r.get("requested_by_user_id"));
      payload.put("outputRef", output);
      payload.put("summary", summary);
      payload.put("errorCode", code);
      events.insert(
          db,
          "processing.job.completed.v1",
          (String) r.get("document_id"),
          ((Number) r.get("document_revision")).longValue(),
          events.envelope("JobCompleted", payload));
    }
  }

  Map<String, Object> parse(Object value) {
    try {
      return json.readValue(
          value instanceof byte[] b ? new String(b, StandardCharsets.UTF_8) : value.toString(),
          Map.class);
    } catch (Exception e) {
      throw new IllegalStateException("Stored JSON invalid", e);
    }
  }

  StorageProvider.ObjectRef ref(Object value) {
    return json.convertValue(parse(value), StorageProvider.ObjectRef.class);
  }

  static Instant instant(Object value) {
    if (value == null) return null;
    return value instanceof Timestamp t
        ? t.toInstant()
        : ((LocalDateTime) value).toInstant(ZoneOffset.UTC);
  }
}
