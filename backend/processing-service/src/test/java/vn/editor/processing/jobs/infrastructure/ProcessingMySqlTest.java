package vn.editor.processing.jobs.infrastructure;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.aop.support.AopUtils;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.mysql.MySQLContainer;
import vn.editor.common.codec.NativeCodec;
import vn.editor.common.storage.LocalStorage;
import vn.editor.common.storage.StorageProvider;
import vn.editor.processing.jobs.application.JobFailure;

@Testcontainers
class ProcessingMySqlTest {
  @Container static MySQLContainer mysql = new MySQLContainer("mysql:8.4.7");
  @TempDir Path dir;
  JdbcJobRepository jobs;
  JobWorker worker;
  ProcessingEvents events;
  JdbcTemplate db;
  AnnotationConfigApplicationContext context;

  @BeforeEach
  void setup() throws Exception {
    var source =
        new DriverManagerDataSource(mysql.getJdbcUrl(), mysql.getUsername(), mysql.getPassword());
    Flyway.configure().dataSource(source).locations("classpath:db/migration").load().migrate();
    db = new JdbcTemplate(source);
    for (String table :
        List.of(
            "output_attempts",
            "inbox_receipts",
            "outbox_events",
            "idempotency_requests",
            "jobs",
            "requester_queues")) db.update("DELETE FROM " + table);
    ObjectMapper json = new ObjectMapper();
    events = new ProcessingEvents(json);
    context =
        ProcessingRepositoryContext.create(
            db, new TransactionTemplate(new DataSourceTransactionManager(source)), events, json);
    jobs = context.getBean(JdbcJobRepository.class);
    StorageProvider storage = new LocalStorage(dir, "http://localhost");
    context.registerBean(StorageProvider.class, () -> storage);
    context.registerBean(JobWorker.class);
    worker = context.getBean(JobWorker.class);
  }

  @AfterEach
  void shutdown() {
    worker.shutdown();
    context.close();
  }

  @Test
  void springPersistenceProxiesRunRealPreviewAndBothExports() throws Exception {
    assertTrue(AopUtils.isCglibProxy(jobs));
    assertTrue(AopUtils.isCglibProxy(context.getBean(JdbcJobExecutionRepository.class)));
    assertTrue(AopUtils.isCglibProxy(context.getBean(JdbcJobOutputCleanupRepository.class)));
    Path fixture = dir.resolve("mixed-runs.tedoc");
    int generated =
        new ProcessBuilder(
                "python", "../../testing/benchmark/native_input.py", "--output", dir.toString())
            .inheritIO()
            .start()
            .waitFor();
    assertEquals(0, generated);
    var decoded = NativeCodec.decode(fixture);
    StorageProvider storage = context.getBean(StorageProvider.class);
    StorageProvider.Metadata source;
    try (var input = Files.newInputStream(fixture)) {
      source =
          storage.writeNew(
              "snapshots/proxy/source.tedoc", input, Files.size(fixture), NativeCodec.MAX_NATIVE);
    }
    Map<String, String> ids = new LinkedHashMap<>();
    for (String type : List.of("PREVIEW", "EXPORT_TXT", "EXPORT_HTML")) {
      String id = UUID.randomUUID().toString();
      ids.put(type, id);
      jobs.insert(
          id,
          UUID.randomUUID().toString(),
          1,
          UUID.randomUUID().toString(),
          type,
          type.equals("PREVIEW"),
          null,
          "READY",
          events.encode(source.ref()),
          decoded.nativeSha256());
    }
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
    while (System.nanoTime() < deadline
        && db.queryForObject("SELECT COUNT(*) FROM jobs WHERE state='SUCCEEDED'", Integer.class)
            < 3) {
      worker.schedule();
      worker.heartbeat();
      Thread.sleep(25);
    }
    assertEquals(
        3, db.queryForObject("SELECT COUNT(*) FROM jobs WHERE state='SUCCEEDED'", Integer.class));
    for (String type : List.of("EXPORT_TXT", "EXPORT_HTML")) {
      Map<String, Object> row = jobs.row(ids.get(type));
      try (var input = storage.read(jobs.ref(row.get("output_ref")))) {
        String output = new String(input.readAllBytes(), StandardCharsets.UTF_8);
        if (type.equals("EXPORT_TXT")) assertEquals("hello world", output);
        else assertTrue(output.contains("<b>hel</b><b><i>lo</i></b><i> wo</i>rld"));
        assertEquals(
            output.getBytes(StandardCharsets.UTF_8).length,
            ((Number) row.get("output_bytes")).intValue());
      }
    }
    Map<String, Object> summary = jobs.parse(jobs.row(ids.get("PREVIEW")).get("summary_json"));
    assertEquals("hello world", summary.get("sampleText"));
    assertEquals(2, ((Number) summary.get("wordCount")).intValue());
    assertEquals(3, db.queryForObject("SELECT COUNT(*) FROM outbox_events", Integer.class));
    assertEquals(
        2,
        db.queryForObject(
            "SELECT COUNT(*) FROM output_attempts WHERE state='PUBLISHED'", Integer.class));
    worker.gc();
    worker.orphanGc();
    worker.retention();
  }

  @Test
  void concurrentIdempotentCreateCommitsExactlyOneJobAndEvent() throws Exception {
    String actor = UUID.randomUUID().toString(), key = UUID.randomUUID().toString();
    var request =
        new vn.editor.processing.jobs.domain.ExportRequest(
            UUID.randomUUID().toString(), 1, "EXPORT_TXT");
    var snapshot =
        new vn.editor.processing.jobs.application.port.SourceSnapshot(
            "{\"provider\":\"LOCAL\",\"bucket\":null,\"key\":\"snapshots/a/b.tedoc\",\"generation\":\"1\"}",
            "a".repeat(64));
    try (var pool = java.util.concurrent.Executors.newFixedThreadPool(8)) {
      var start = new java.util.concurrent.CountDownLatch(1);
      var futures = new ArrayList<java.util.concurrent.Future<Map<String, Object>>>();
      for (int i = 0; i < 8; i++)
        futures.add(
            pool.submit(
                () -> {
                  start.await();
                  return jobs.create(actor, key, request, snapshot);
                }));
      start.countDown();
      var ids = new HashSet<Object>();
      for (var future : futures)
        ids.add(future.get(20, java.util.concurrent.TimeUnit.SECONDS).get("id"));
      assertEquals(1, ids.size());
    }
    assertEquals(1, db.queryForObject("SELECT COUNT(*) FROM jobs", Integer.class));
    assertEquals(1, db.queryForObject("SELECT COUNT(*) FROM outbox_events", Integer.class));
    assertEquals(1, db.queryForObject("SELECT COUNT(*) FROM idempotency_requests", Integer.class));
    var other =
        new vn.editor.processing.jobs.domain.ExportRequest(request.documentId(), 1, "EXPORT_HTML");
    assertEquals(
        "IDEMPOTENCY_KEY_REUSED",
        assertThrows(JobFailure.class, () -> jobs.create(actor, key, other, snapshot)).code);
  }

  @Test
  void concurrentDistinctCreatesCannotExceedRequesterQuota() throws Exception {
    String actor = UUID.randomUUID().toString();
    var request =
        new vn.editor.processing.jobs.domain.ExportRequest(
            UUID.randomUUID().toString(), 1, "EXPORT_TXT");
    var snapshot =
        new vn.editor.processing.jobs.application.port.SourceSnapshot(
            "{\"provider\":\"LOCAL\",\"bucket\":null,\"key\":\"snapshots/a/b.tedoc\",\"generation\":\"1\"}",
            "a".repeat(64));
    int accepted = 0, denied = 0;
    try (var pool = java.util.concurrent.Executors.newFixedThreadPool(8)) {
      var start = new java.util.concurrent.CountDownLatch(1);
      var futures = new ArrayList<java.util.concurrent.Future<String>>();
      for (int i = 0; i < 8; i++)
        futures.add(
            pool.submit(
                () -> {
                  start.await();
                  try {
                    jobs.create(actor, UUID.randomUUID().toString(), request, snapshot);
                    return "ACCEPTED";
                  } catch (JobFailure failure) {
                    return failure.code;
                  }
                }));
      start.countDown();
      for (var future : futures) {
        String outcome = future.get(20, java.util.concurrent.TimeUnit.SECONDS);
        if (outcome.equals("ACCEPTED")) accepted++;
        else {
          assertEquals("QUOTA_EXCEEDED", outcome);
          denied++;
        }
      }
    }
    assertEquals(5, accepted);
    assertEquals(3, denied);
    assertEquals(5, db.queryForObject("SELECT COUNT(*) FROM jobs", Integer.class));
    assertEquals(5, db.queryForObject("SELECT COUNT(*) FROM outbox_events", Integer.class));
    assertEquals(5, db.queryForObject("SELECT COUNT(*) FROM idempotency_requests", Integer.class));
  }

  @Test
  void persistedOriginTraceSurvivesNewWorkerAndCompletionOutbox() throws Exception {
    String trace = "a".repeat(32);
    var event = saved();
    event.put("traceId", trace);
    jobs.documentSaved(event);
    assertEquals(trace, db.queryForObject("SELECT trace_id FROM jobs", String.class));
    worker.shutdown();
    worker =
        new JobWorker(
            context.getBean(JdbcJobExecutionRepository.class),
            context.getBean(JdbcJobOutputCleanupRepository.class),
            new LocalStorage(dir, "http://localhost"));
    var claim = worker.claim();
    assertTrue(
        worker.finish(
            (String) claim.get("id"),
            (String) claim.get("lease_owner"),
            null,
            0,
            Map.of("wordCount", 0, "sampleText", "")));
    var completed =
        events.parse(
            "processing.job.completed.v1",
            db.queryForObject("SELECT payload FROM outbox_events", String.class));
    assertEquals(trace, completed.get("traceId"));
  }

  @Test
  void retentionDeletesOnlyExpiredPublishedRowsAndIdempotency() {
    String doc = UUID.randomUUID().toString();
    for (int i = 0; i < 3; i++) {
      events.insert(
          db,
          "processing.job.requested.v1",
          doc,
          1,
          events.envelope(
              "JobRequested",
              Map.of("jobId", UUID.randomUUID().toString(), "documentId", doc, "revision", 1)));
    }
    var ids = db.queryForList("SELECT id FROM outbox_events ORDER BY id", Long.class);
    db.update(
        "UPDATE outbox_events SET created_at=UTC_TIMESTAMP(6)-INTERVAL 8 DAY,published_at=UTC_TIMESTAMP(6)-INTERVAL 8 DAY WHERE id=?",
        ids.get(0));
    db.update(
        "UPDATE outbox_events SET created_at=UTC_TIMESTAMP(6)-INTERVAL 8 DAY WHERE id=?",
        ids.get(1));
    db.update("UPDATE outbox_events SET published_at=UTC_TIMESTAMP(6) WHERE id=?", ids.get(2));
    for (int i = 0; i < 2; i++)
      db.update(
          "INSERT INTO idempotency_requests(actor_user_id,operation_key,idempotency_key,request_sha256,response_status,response_body,created_at,expires_at) VALUES(?,'create-job',?, ?,202,'{}',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6)+INTERVAL ? SECOND)",
          UUID.randomUUID().toString(),
          UUID.randomUUID().toString(),
          "a".repeat(64),
          i == 0 ? -1 : 3600);
    worker.retention();
    assertEquals(
        List.of(ids.get(1), ids.get(2)),
        db.queryForList("SELECT id FROM outbox_events ORDER BY id", Long.class));
    assertEquals(1, db.queryForObject("SELECT COUNT(*) FROM idempotency_requests", Integer.class));
  }

  Map<String, Object> saved() {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("documentId", UUID.randomUUID().toString());
    p.put("versionId", UUID.randomUUID().toString());
    p.put("revision", 1);
    p.put("ownerUserId", UUID.randomUUID().toString());
    p.put("actorUserId", p.get("ownerUserId"));
    p.put("objectRef", new StorageProvider.ObjectRef("LOCAL", null, "snapshots/a/b.tedoc", "1"));
    p.put("nativeSha256", "a".repeat(64));
    p.put("nativeBytes", 1024);
    p.put("textUtf8Bytes", 11);
    p.put("utf16Length", 11);
    p.put("logicalLines", 1);
    var e = events.envelope("DocumentVersionSaved", p);
    e.put("producer", "document-service");
    return e;
  }

  @Test
  void inboxDuplicatesAndRedeliveryAfterCommitCreateOneDurablePreview() {
    Map<String, Object> event = saved();
    jobs.documentSaved(event);
    jobs.documentSaved(event);
    assertEquals(1, db.queryForObject("SELECT COUNT(*) FROM jobs", Integer.class));
    assertEquals(1, db.queryForObject("SELECT COUNT(*) FROM inbox_receipts", Integer.class));
    assertEquals("READY", db.queryForObject("SELECT state FROM jobs", String.class));
    event.put("eventId", UUID.randomUUID().toString());
    jobs.documentSaved(event);
    assertEquals(1, db.queryForObject("SELECT COUNT(*) FROM jobs", Integer.class));
    assertEquals(2, db.queryForObject("SELECT COUNT(*) FROM inbox_receipts", Integer.class));
  }

  @Test
  void staleWorkerCannotPublishAfterLeaseReclaim() {
    jobs.documentSaved(saved());
    var first = worker.claim();
    String id = (String) first.get("id"), owner = (String) first.get("lease_owner");
    db.update("UPDATE jobs SET lease_until=UTC_TIMESTAMP(6)-INTERVAL 1 SECOND WHERE id=?", id);
    var second = worker.claim();
    assertNotEquals(owner, second.get("lease_owner"));
    assertFalse(worker.finish(id, owner, null, 0, Map.of("wordCount", 1, "sampleText", "x")));
    assertEquals("RUNNING", jobs.row(id).get("state"));
    assertEquals(0, db.queryForObject("SELECT COUNT(*) FROM outbox_events", Integer.class));
    assertTrue(
        worker.finish(
            id,
            (String) second.get("lease_owner"),
            null,
            0,
            Map.of("wordCount", 1, "sampleText", "x")));
    assertEquals("SUCCEEDED", jobs.row(id).get("state"));
    assertEquals(2, ((Number) jobs.row(id).get("attempts")).intValue());
    assertEquals(1, db.queryForObject("SELECT COUNT(*) FROM outbox_events", Integer.class));
  }

  @Test
  void cancelWinsCompletionRaceAndDeadlineCannotSucceed() {
    jobs.documentSaved(saved());
    var run = worker.claim();
    String id = (String) run.get("id"), owner = (String) run.get("lease_owner");
    db.update("UPDATE jobs SET cancel_requested=TRUE WHERE id=?", id);
    assertFalse(worker.finish(id, owner, null, 0, Map.of("wordCount", 0, "sampleText", "")));
    assertEquals("CANCELLED", jobs.row(id).get("state"));
    jobs.documentSaved(saved());
    run = worker.claim();
    id = (String) run.get("id");
    owner = (String) run.get("lease_owner");
    db.update("UPDATE jobs SET deadline_at=UTC_TIMESTAMP(6)-INTERVAL 1 SECOND WHERE id=?", id);
    assertFalse(worker.finish(id, owner, null, 0, Map.of("wordCount", 0, "sampleText", "")));
    assertEquals("JOB_DEADLINE", jobs.row(id).get("error_code"));
  }

  @Test
  void transientRetriesAreBoundedAtThreeAttempts() {
    jobs.documentSaved(saved());
    String id = null;
    for (int n = 1; n <= 3; n++) {
      var r = worker.claim();
      assertNotNull(r);
      id = (String) r.get("id");
      worker.fail(id, (String) r.get("lease_owner"), "STORAGE_IO", true, false);
      assertEquals(n < 3 ? "READY" : "FAILED", jobs.row(id).get("state"));
      db.update("UPDATE jobs SET next_attempt_at=UTC_TIMESTAMP(6) WHERE id=?", id);
    }
    assertEquals(3, ((Number) jobs.row(id).get("attempts")).intValue());
    assertNull(worker.claim());
    assertEquals(1, db.queryForObject("SELECT COUNT(*) FROM outbox_events", Integer.class));
  }

  @Test
  void requestedInboxAtomicallyMovesQueuedToReady() {
    var event = saved();
    Map<String, Object> p = (Map<String, Object>) event.get("payload");
    String id = UUID.randomUUID().toString();
    jobs.insert(
        id,
        (String) p.get("documentId"),
        1,
        (String) p.get("ownerUserId"),
        "EXPORT_TXT",
        false,
        null,
        "QUEUED",
        events.encode(p.get("objectRef")),
        "a".repeat(64));
    Map<String, Object> requested =
        events.envelope(
            "JobRequested", Map.of("jobId", id, "documentId", p.get("documentId"), "revision", 1));
    jobs.requested(requested);
    jobs.requested(requested);
    assertEquals("READY", jobs.row(id).get("state"));
    assertEquals(1, db.queryForObject("SELECT COUNT(*) FROM inbox_receipts", Integer.class));
  }

  @Test
  void outputGcRetainsReferencedResultThenDeletesExpiredGeneration() throws Exception {
    String id = UUID.randomUUID().toString(),
        doc = UUID.randomUUID().toString(),
        user = UUID.randomUUID().toString();
    jobs.insert(
        id,
        doc,
        1,
        user,
        "EXPORT_TXT",
        false,
        null,
        "READY",
        "{\"provider\":\"LOCAL\",\"bucket\":null,\"key\":\"snapshots/a/b.tedoc\",\"generation\":\"1\"}",
        "a".repeat(64));
    var run = worker.claim();
    String owner = (String) run.get("lease_owner");
    var storage = new LocalStorage(dir, "http://localhost");
    String key = "results/" + id + "/" + owner + ".txt";
    var output =
        storage.writeNew(key, new java.io.ByteArrayInputStream(new byte[] {65}), 1, 67108864);
    db.update(
        "INSERT INTO output_attempts(attempt_id,job_id,output_key,state,created_at,updated_at) VALUES(?,?,?,'RESERVED',UTC_TIMESTAMP(6)-INTERVAL 25 HOUR,UTC_TIMESTAMP(6))",
        owner,
        id,
        key);
    assertTrue(worker.finish(id, owner, output.ref(), 1, null));
    worker.orphanGc();
    assertEquals(1, storage.inspect(key).bytes());
    db.update(
        "UPDATE jobs SET output_expires_at=UTC_TIMESTAMP(6)-INTERVAL 1 SECOND WHERE id=?", id);
    worker.gc();
    worker.orphanGc();
    assertThrows(java.nio.file.NoSuchFileException.class, () -> storage.inspect(key));
    assertNull(jobs.row(id).get("output_ref"));
    assertEquals(
        "CLEANED",
        db.queryForObject(
            "SELECT state FROM output_attempts WHERE attempt_id=?", String.class, owner));
  }

  @Test
  void attemptWatchdogRevokesPublicationAndSchedulesBoundedRetry() {
    jobs.documentSaved(saved());
    var run = worker.claim();
    String id = (String) run.get("id"), owner = (String) run.get("lease_owner");
    worker.timeoutAttempt(id, owner);
    assertEquals("READY", jobs.row(id).get("state"));
    assertEquals("ATTEMPT_DEADLINE", jobs.row(id).get("error_code"));
    assertFalse(worker.finish(id, owner, null, 0, Map.of("wordCount", 0, "sampleText", "")));
    assertEquals(0, db.queryForObject("SELECT COUNT(*) FROM outbox_events", Integer.class));
  }
}
