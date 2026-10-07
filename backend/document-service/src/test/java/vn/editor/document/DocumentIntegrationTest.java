package vn.editor.document;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.mysql.MySQLContainer;
import vn.editor.common.codec.NativeCodec;
import vn.editor.common.messaging.EventSchemas;
import vn.editor.common.storage.LocalStorage;
import vn.editor.common.storage.StorageProvider;
import vn.editor.document.bootstrap.DocumentApplication;
import vn.editor.document.documents.application.command.ApplyPreviewCompletionCommand;
import vn.editor.document.documents.application.command.ApplyPreviewCompletionHandler;
import vn.editor.document.documents.application.command.RetentionCommandHandler;
import vn.editor.document.documents.application.command.SaveResult;
import vn.editor.document.documents.infrastructure.JdbcOutbox;
import vn.editor.document.documents.infrastructure.JdbcRetention;
import vn.editor.document.shared.domain.DomainException;

class DocumentIntegrationTest {
  static MySQLContainer mysql;
  static JdbcTemplate db;
  static DriverManagerDataSource source;
  @TempDir Path temp;
  DocumentHarness s;
  String owner, other;

  @BeforeAll
  static void start() {
    mysql = new MySQLContainer("mysql:8.4.7").withDatabaseName("document_db");
    mysql.start();
    source =
        new DriverManagerDataSource(
            mysql.getJdbcUrl()
                + (mysql.getJdbcUrl().contains("?") ? "&" : "?")
                + "connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true",
            mysql.getUsername(),
            mysql.getPassword());
    db = new JdbcTemplate(source);
    Flyway.configure().dataSource(source).locations("classpath:db/migration").load().migrate();
    assertEquals(
        0,
        Flyway.configure()
            .dataSource(source)
            .locations("classpath:db/migration")
            .load()
            .migrate()
            .migrationsExecuted);
  }

  @AfterAll
  static void stop() {
    if (mysql != null) mysql.stop();
  }

  @BeforeEach
  void setup() throws Exception {
    s =
        new DocumentHarness(
            db,
            new DataSourceTransactionManager(source),
            new LocalStorage(temp, "http://localhost:8080"),
            "http://localhost:8080",
            100,
            100);
    owner = DocumentHarness.uuid();
    other = DocumentHarness.uuid();
  }

  Map<String, Object> folder(String actor, String name, String parent) {
    return s.createFolder(actor, DocumentHarness.map("name", name, "parentId", parent));
  }

  String doc() {
    Map<String, Object> result =
        s.createDocument(owner, DocumentHarness.map("title", "Document", "folderId", null));
    assertTrue(
        Math.abs(
                java.time.Duration.between(
                        Instant.parse(result.get("createdAt").toString()), Instant.now())
                    .toSeconds())
            < 3,
        "UTC timestamp must represent the actual creation instant");
    return (String) result.get("id");
  }

  String upload(String actor, String doc, String fixture, long expected) throws Exception {
    byte[] bytes = Files.readAllBytes(Path.of("../../testing/fixtures/native", fixture));
    Map<String, Object> ticket =
        s.createUpload(
            actor,
            doc,
            DocumentHarness.map(
                "expectedHeadRevision",
                expected,
                "nativeBytes",
                bytes.length,
                "nativeSha256",
                NativeCodec.sha256(bytes)));
    String id = (String) ticket.get("uploadId");
    s.upload(actor, id, bytes.length, new ByteArrayInputStream(bytes));
    return id;
  }

  SaveResult commit(String actor, String doc, String upload, long head, String key)
      throws Exception {
    return s.commit(
        actor, doc, key, DocumentHarness.map("uploadId", upload, "expectedHeadRevision", head));
  }

  void error(int status, String code, org.junit.jupiter.api.function.Executable action) {
    DomainException e = assertThrows(DomainException.class, action, code);
    assertEquals(status, e.status);
    assertEquals(code, e.code);
  }

  @Test
  void folderIsolationCollationDepthAndRestore() throws Exception {
    String f = (String) folder(owner, "R\u00e9sum\u00e9", null).get("id");
    error(409, "FOLDER_NAME_EXISTS", () -> folder(owner, "R\u00c9SUM\u00c9", null));
    folder(owner, "Resume", null);
    error(404, "FOLDER_NOT_FOUND", () -> s.getFolder(other, f));
    String deep = f;
    for (int i = 2; i <= 20; i++) deep = (String) folder(owner, "level" + i, deep).get("id");
    String deepest = deep;
    error(409, "FOLDER_DEPTH_EXCEEDED", () -> folder(owner, "too deep", deepest));
    String doc =
        (String)
            s.createDocument(owner, DocumentHarness.map("title", "File", "folderId", deepest))
                .get("id");
    error(409, "FOLDER_NOT_EMPTY", () -> s.deleteFolder(owner, deepest, 1));
    s.trash(owner, doc, Map.of("expectedMetadataRevision", 1), false);
    s.deleteFolder(owner, deepest, 1);
    Map<String, Object> restored = s.trash(owner, doc, Map.of("expectedMetadataRevision", 2), true);
    assertNull(restored.get("folderId"));
    assertEquals(0L, ((Number) restored.get("headRevision")).longValue());
  }

  @Test
  void concurrentFolderMovesCannotCreateCycle() throws Exception {
    String a = (String) folder(owner, "a", null).get("id"),
        b = (String) folder(owner, "b", null).get("id");
    ExecutorService executor = Executors.newFixedThreadPool(2);
    CountDownLatch start = new CountDownLatch(1);
    Callable<Boolean> ab =
        () -> {
          start.await();
          try {
            s.patchFolder(owner, a, Map.of("expectedMetadataRevision", 1, "parentId", b));
            return true;
          } catch (DomainException e) {
            assertEquals("FOLDER_CYCLE", e.code);
            return false;
          }
        };
    Callable<Boolean> ba =
        () -> {
          start.await();
          try {
            s.patchFolder(owner, b, Map.of("expectedMetadataRevision", 1, "parentId", a));
            return true;
          } catch (DomainException e) {
            assertEquals("FOLDER_CYCLE", e.code);
            return false;
          }
        };
    var x = executor.submit(ab);
    var y = executor.submit(ba);
    start.countDown();
    assertNotEquals(x.get(15, TimeUnit.SECONDS), y.get(15, TimeUnit.SECONDS));
    executor.shutdownNow();
    assertTrue(s.depth(owner, a) <= 2);
    assertTrue(s.depth(owner, b) <= 2);
  }

  @Test
  void savesIdempotencyConflictFormattingAndNoChange() throws Exception {
    String d = doc(),
        up = upload(owner, d, "mixed-runs.tedoc", 0),
        competing = upload(owner, d, "unicode-uniform.tedoc", 0),
        key = DocumentHarness.uuid();
    var first = commit(owner, d, up, 0, key);
    assertEquals(201, first.status());
    assertEquals(
        s.json.readTree(s.encode(first.body())),
        s.json.readTree(s.encode(commit(owner, d, up, 0, key).body())));
    error(409, "REVISION_CONFLICT", () -> commit(owner, d, competing, 0, DocumentHarness.uuid()));
    error(409, "IDEMPOTENCY_KEY_REUSED", () -> commit(owner, d, competing, 0, key));
    String same = upload(owner, d, "mixed-runs.tedoc", 1);
    assertEquals(200, commit(owner, d, same, 1, DocumentHarness.uuid()).status());
    assertEquals(
        1,
        db.queryForObject(
            "SELECT COUNT(*) FROM document_versions WHERE document_id=?", Integer.class, d));
    assertEquals(
        1,
        db.queryForObject(
            "SELECT COUNT(*) FROM outbox_events WHERE aggregate_id=?", Integer.class, d));
    Path reopened = temp.resolve("reopened.tedoc");
    try (InputStream in = s.content(owner, d, 1)) {
      Files.copy(in, reopened);
    }
    assertArrayEquals(
        new byte[] {1, 1, 1, 3, 3, 2, 2, 2, 0, 0, 0}, NativeCodec.decode(reopened).masks());
    s.patchDocument(owner, d, Map.of("expectedMetadataRevision", 1, "title", "Renamed"));
    assertEquals(1L, ((Number) s.document(owner, d).get("headRevision")).longValue());
  }

  @Test
  void simultaneousCommitsOneWins() throws Exception {
    String d = doc(),
        a = upload(owner, d, "mixed-runs.tedoc", 0),
        b = upload(owner, d, "unicode-uniform.tedoc", 0);
    ExecutorService executor = Executors.newFixedThreadPool(2);
    CountDownLatch start = new CountDownLatch(1);
    List<Future<Integer>> futures = new ArrayList<>();
    for (String up : List.of(a, b))
      futures.add(
          executor.submit(
              () -> {
                start.await();
                try {
                  return commit(owner, d, up, 0, DocumentHarness.uuid()).status();
                } catch (DomainException ex) {
                  return ex.status;
                }
              }));
    start.countDown();
    List<Integer> statuses =
        List.of(futures.get(0).get(15, TimeUnit.SECONDS), futures.get(1).get(15, TimeUnit.SECONDS));
    assertTrue(statuses.contains(201));
    assertTrue(statuses.contains(409));
    executor.shutdownNow();
    assertEquals(
        1,
        db.queryForObject(
            "SELECT COUNT(*) FROM document_versions WHERE document_id=?", Integer.class, d));
  }

  @Test
  void aclRevocationPublicPrivacyTrashRestorationAndExpiry() throws Exception {
    String d = doc();
    s.grant(owner, d, other, "VIEWER");
    assertNull(s.document(other, d).get("folderId"));
    error(403, "READ_ONLY", () -> upload(other, d, "mixed-runs.tedoc", 0));
    s.grant(owner, d, other, "EDITOR");
    String up = upload(other, d, "mixed-runs.tedoc", 0);
    error(
        403,
        "OWNER_REQUIRED",
        () -> s.patchDocument(other, d, Map.of("expectedMetadataRevision", 1, "title", "wrong")));
    error(403, "OWNER_REQUIRED", () -> s.createLink(other, d, Map.of()));
    s.revoke(owner, d, other);
    error(404, "DOCUMENT_NOT_FOUND", () -> commit(other, d, up, 0, DocumentHarness.uuid()));
    String ownerUp = upload(owner, d, "mixed-runs.tedoc", 0);
    commit(owner, d, ownerUp, 0, DocumentHarness.uuid());
    Map<String, Object> link = s.createLink(owner, d, Map.of());
    String token = (String) link.get("token");
    assertEquals(43, token.length());
    assertEquals(
        Set.of("documentId", "title", "headRevision", "empty", "contentPath"),
        s.publicDocument(token).keySet());
    assertFalse(
        db.queryForObject(
                "SELECT token_sha256 FROM share_links WHERE document_id=?", String.class, d)
            .contains(token));
    s.trash(owner, d, Map.of("expectedMetadataRevision", 1), false);
    error(404, "DOCUMENT_NOT_FOUND", () -> s.publicDocument(token));
    s.trash(owner, d, Map.of("expectedMetadataRevision", 2), true);
    assertEquals(d, s.publicDocument(token).get("documentId"));
    s.revokeLink(owner, d, ((Map<String, Object>) link.get("link")).get("id").toString());
    error(404, "DOCUMENT_NOT_FOUND", () -> s.publicDocument(token));
    error(404, "DOCUMENT_NOT_FOUND", () -> s.publicDocument("invalid"));
    String expiring = (String) s.createLink(owner, d, Map.of()).get("token");
    db.update(
        "UPDATE share_links SET created_at=?,expires_at=? WHERE document_id=? AND revoked_at IS"
            + " NULL",
        Timestamp.from(Instant.now().minusSeconds(7200)),
        Timestamp.from(Instant.now().minusSeconds(3600)),
        d);
    error(404, "DOCUMENT_NOT_FOUND", () -> s.publicDocument(expiring));
  }

  @Test
  void invalidNativeNeverChangesHeadAndOutboxPayloadMatchesContract() throws Exception {
    String d = doc();
    byte[] bytes = "Not a valid native archive".getBytes();
    Map<String, Object> t =
        s.createUpload(
            owner,
            d,
            DocumentHarness.map(
                "expectedHeadRevision",
                0,
                "nativeBytes",
                bytes.length,
                "nativeSha256",
                NativeCodec.sha256(bytes)));
    s.upload(owner, t.get("uploadId").toString(), bytes.length, new ByteArrayInputStream(bytes));
    error(
        422,
        "INVALID_NATIVE_FILE",
        () -> commit(owner, d, t.get("uploadId").toString(), 0, DocumentHarness.uuid()));
    assertEquals(0L, ((Number) s.document(owner, d).get("headRevision")).longValue());
    String up = upload(owner, d, "empty.tedoc", 0);
    commit(owner, d, up, 0, DocumentHarness.uuid());
    assertTrue(
        EventSchemas.valid(
            "document.version.saved.v1",
            db.queryForObject(
                "SELECT payload FROM outbox_events WHERE aggregate_id=?", String.class, d)));
  }

  @Test
  void retentionGraceNeverDeletesHeadOrCommittedOrphan() throws Exception {
    String d = doc();
    String up = upload(owner, d, "mixed-runs.tedoc", 0);
    commit(owner, d, up, 0, DocumentHarness.uuid());
    db.update(
        "UPDATE upload_sessions SET expires_at=? WHERE id=?",
        Timestamp.from(Instant.now().minusSeconds(7200)),
        up);
    RetentionCommandHandler gc = s.retention;
    gc.expireUploads();
    assertNotNull(
        s.storage.inspect(
            db.queryForObject(
                "SELECT object_key FROM upload_sessions WHERE id=?", String.class, up)));
    db.update(
        "UPDATE document_versions SET retired_at=?,last_access_at=? WHERE document_id=?",
        Timestamp.from(Instant.now().minusSeconds(7200)),
        Timestamp.from(Instant.now().minusSeconds(7200)),
        d);
    gc.retiredVersions();
    assertNotNull(
        s.storage.inspect(
            db.queryForObject(
                "SELECT object_key FROM document_versions WHERE document_id=?", String.class, d)));
  }

  @Test
  void previewInboxDuplicateAndReorderedGuard() throws Exception {
    String d = doc(), up = upload(owner, d, "empty.tedoc", 0);
    commit(owner, d, up, 0, DocumentHarness.uuid());
    ApplyPreviewCompletionHandler events = s.projection;
    String event = DocumentHarness.uuid();
    Map<String, Object> p =
        Map.of(
            "documentId",
            d,
            "revision",
            1,
            "type",
            "PREVIEW",
            "state",
            "SUCCEEDED",
            "summary",
            Map.of("wordCount", 3, "sampleText", "new"));
    events.handle(
        ApplyPreviewCompletionCommand.from(DocumentHarness.map("eventId", event, "payload", p)));
    events.handle(
        ApplyPreviewCompletionCommand.from(DocumentHarness.map("eventId", event, "payload", p)));
    assertEquals(
        1,
        db.queryForObject(
            "SELECT COUNT(*) FROM inbox_receipts WHERE event_id=?", Integer.class, event));
    events.handle(
        ApplyPreviewCompletionCommand.from(
            DocumentHarness.map(
                "eventId",
                DocumentHarness.uuid(),
                "payload",
                Map.of(
                    "documentId",
                    d,
                    "revision",
                    0,
                    "type",
                    "PREVIEW",
                    "state",
                    "SUCCEEDED",
                    "summary",
                    Map.of("wordCount", 99, "sampleText", "old")))));
    assertEquals(
        "new", ((Map<String, Object>) s.document(owner, d).get("preview")).get("sampleText"));
  }

  @Test
  void twentyVersionRetentionAndReadGraceAreReferenceAware() throws Exception {
    String d = doc();
    for (int revision = 0; revision < 22; revision++) {
      String up =
          upload(
              owner, d, revision % 2 == 0 ? "mixed-runs.tedoc" : "unicode-uniform.tedoc", revision);
      commit(owner, d, up, revision, DocumentHarness.uuid());
    }
    assertEquals(20, ((List<?>) s.versions(owner, d, null, 100).get("items")).size());
    error(410, "VERSION_GONE", () -> s.download(owner, d, 1));
    RetentionCommandHandler gc = s.retention;
    String old =
        db.queryForObject(
            "SELECT object_key FROM document_versions WHERE document_id=? AND revision=1",
            String.class,
            d);
    db.update(
        "UPDATE document_versions SET retired_at=? WHERE document_id=? AND revision=1",
        Timestamp.from(Instant.now().minusSeconds(7200)),
        d);
    gc.retiredVersions();
    assertNotNull(s.storage.inspect(old));
    db.update(
        "UPDATE document_versions SET last_access_at=? WHERE document_id=? AND revision=1",
        Timestamp.from(Instant.now().minusSeconds(7200)),
        d);
    gc.retiredVersions();
    assertThrows(java.nio.file.NoSuchFileException.class, () -> s.storage.inspect(old));
    assertNotNull(
        s.storage.inspect(
            db.queryForObject(
                "SELECT object_key FROM document_versions WHERE document_id=? AND revision=22",
                String.class,
                d)));
  }

  @Test
  void expiredUnuploadedTicketCanBeCleanedAndCommittedRetryPrecedesTtl() throws Exception {
    String d = doc();
    Map<String, Object> emptyTicket =
        s.createUpload(
            owner,
            d,
            Map.of("expectedHeadRevision", 0, "nativeBytes", 20, "nativeSha256", "a".repeat(64)));
    db.update(
        "UPDATE upload_sessions SET expires_at=? WHERE id=?",
        Timestamp.from(Instant.now().minusSeconds(7200)),
        emptyTicket.get("uploadId"));
    s.retention.expireUploads();
    assertNotNull(
        db.queryForObject(
            "SELECT object_deleted_at FROM upload_sessions WHERE id=?",
            Timestamp.class,
            emptyTicket.get("uploadId")));
    String up = upload(owner, d, "mixed-runs.tedoc", 0), key = DocumentHarness.uuid();
    SaveResult first = commit(owner, d, up, 0, key);
    db.update(
        "UPDATE upload_sessions SET expires_at=? WHERE id=?",
        Timestamp.from(Instant.now().minusSeconds(7200)),
        up);
    assertEquals(
        s.json.readTree(s.encode(first.body())),
        s.json.readTree(s.encode(commit(owner, d, up, 0, key).body())));
  }

  @Test
  void quotasAreAtomicUnderConcurrentCreation() throws Exception {
    DocumentHarness limited =
        new DocumentHarness(
            db, new DataSourceTransactionManager(source), s.storage, "http://localhost:8080", 1, 1);
    ExecutorService executor = Executors.newFixedThreadPool(2);
    CountDownLatch start = new CountDownLatch(1);
    List<Future<Integer>> futures = new ArrayList<>();
    for (int i = 0; i < 2; i++)
      futures.add(
          executor.submit(
              () -> {
                start.await();
                try {
                  limited.createDocument(
                      owner, DocumentHarness.map("title", "One", "folderId", null));
                  return 201;
                } catch (DomainException ex) {
                  return ex.status;
                }
              }));
    start.countDown();
    List<Integer> codes =
        List.of(futures.get(0).get(15, TimeUnit.SECONDS), futures.get(1).get(15, TimeUnit.SECONDS));
    assertTrue(codes.contains(201));
    assertTrue(codes.contains(429));
    executor.shutdownNow();
    assertEquals(
        1,
        db.queryForObject(
            "SELECT COUNT(*) FROM documents WHERE owner_user_id=?", Integer.class, owner));
  }

  @Test
  void productionHttpWiringPreservesTwoActorAclNativeBytesAndPublicContracts() throws Exception {
    RSAKey key = new RSAKeyGenerator(2048).keyID("http-test-key").generate();
    HttpServer issuer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    issuer.createContext(
        "/jwks",
        exchange -> {
          byte[] body = new JWKSet(key.toPublicJWK()).toString().getBytes(StandardCharsets.UTF_8);
          exchange.getResponseHeaders().set("Content-Type", "application/json");
          exchange.sendResponseHeaders(200, body.length);
          try (var out = exchange.getResponseBody()) {
            out.write(body);
          }
        });
    issuer.start();
    try (GenericContainer<?> redis =
        new GenericContainer<>("redis:8.4.0-alpine").withExposedPorts(6379)) {
      redis.start();
      try (ConfigurableApplicationContext context =
          SpringApplication.run(
              DocumentApplication.class,
              "--server.port=0",
              "--spring.datasource.url=" + source.getUrl(),
              "--spring.datasource.username=" + source.getUsername(),
              "--spring.datasource.password=" + source.getPassword(),
              "--spring.data.redis.host=" + redis.getHost(),
              "--spring.data.redis.port=" + redis.getMappedPort(6379),
              "--spring.kafka.listener.auto-startup=false",
              "--spring.kafka.bootstrap-servers=127.0.0.1:1",
              "--spring.kafka.producer.properties.max.block.ms=100",
              "--editor.storage.root=" + temp,
              "--editor.jwt.issuer=http://document-http.test",
              "--editor.jwt.jwk-uri=http://127.0.0.1:" + issuer.getAddress().getPort() + "/jwks",
              "--logging.level.root=WARN")) {
        String base =
            "http://127.0.0.1:" + context.getEnvironment().getRequiredProperty("local.server.port");
        String ownerToken = token(key, owner), otherToken = token(key, other);
        HttpClient client = HttpClient.newHttpClient();
        assertEquals(
            401, http(client, base, "GET", "/api/v1/documents", null, null, null).statusCode());
        var folder =
            http(
                client,
                base,
                "POST",
                "/api/v1/folders",
                ownerToken,
                s.encode(DocumentHarness.map("name", "HTTP folder", "parentId", null)),
                null);
        assertEquals(201, folder.statusCode(), folder.body());
        String folderId = s.json.readTree(folder.body()).path("id").asText();
        var created =
            http(
                client,
                base,
                "POST",
                "/api/v1/documents",
                ownerToken,
                s.encode(DocumentHarness.map("title", "HTTP document", "folderId", folderId)),
                null);
        assertEquals(201, created.statusCode(), created.body());
        String document = s.json.readTree(created.body()).path("id").asText();
        assertEquals(
            404,
            http(client, base, "GET", "/api/v1/documents/" + document, otherToken, null, null)
                .statusCode());
        s.grant(owner, document, other, "EDITOR");
        byte[] nativeBytes =
            Files.readAllBytes(Path.of("../../testing/fixtures/native/mixed-runs.tedoc"));
        var reserved =
            http(
                client,
                base,
                "POST",
                "/api/v1/documents/" + document + "/uploads",
                otherToken,
                s.encode(
                    Map.of(
                        "expectedHeadRevision",
                        0,
                        "nativeBytes",
                        nativeBytes.length,
                        "nativeSha256",
                        NativeCodec.sha256(nativeBytes))),
                null);
        assertEquals(201, reserved.statusCode(), reserved.body());
        String upload = s.json.readTree(reserved.body()).path("uploadId").asText();
        var uploaded =
            client.send(
                HttpRequest.newBuilder(URI.create(base + "/api/v1/uploads/" + upload + "/content"))
                    .header("Authorization", "Bearer " + otherToken)
                    .header("Content-Type", "application/octet-stream")
                    .PUT(HttpRequest.BodyPublishers.ofByteArray(nativeBytes))
                    .build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(204, uploaded.statusCode(), uploaded.body());
        String idempotency = DocumentHarness.uuid(),
            body = s.encode(Map.of("uploadId", upload, "expectedHeadRevision", 0));
        var committed =
            http(
                client,
                base,
                "POST",
                "/api/v1/documents/" + document + "/versions",
                otherToken,
                body,
                idempotency);
        assertEquals(201, committed.statusCode(), committed.body());
        assertEquals(
            s.json.readTree(committed.body()),
            s.json.readTree(
                http(
                        client,
                        base,
                        "POST",
                        "/api/v1/documents/" + document + "/versions",
                        otherToken,
                        body,
                        idempotency)
                    .body()));
        var reopened =
            client.send(
                HttpRequest.newBuilder(
                        URI.create(base + "/api/v1/documents/" + document + "/versions/1/content"))
                    .header("Authorization", "Bearer " + ownerToken)
                    .GET()
                    .build(),
                HttpResponse.BodyHandlers.ofByteArray());
        assertEquals(200, reopened.statusCode());
        assertArrayEquals(nativeBytes, reopened.body());
        var link =
            http(
                client,
                base,
                "POST",
                "/api/v1/documents/" + document + "/share-links",
                ownerToken,
                "{}",
                null);
        assertEquals(201, link.statusCode(), link.body());
        String publicToken = s.json.readTree(link.body()).path("token").asText();
        var publicDocument =
            http(client, base, "GET", "/api/v1/public/shares/" + publicToken, null, null, null);
        assertEquals(200, publicDocument.statusCode(), publicDocument.body());
        assertEquals(5, s.json.readTree(publicDocument.body()).size());
        assertEquals(
            204,
            http(
                    client,
                    base,
                    "DELETE",
                    "/api/v1/documents/" + document + "/permissions/" + other,
                    ownerToken,
                    null,
                    null)
                .statusCode());
        assertEquals(
            404,
            http(client, base, "GET", "/api/v1/documents/" + document, otherToken, null, null)
                .statusCode());
        assertEquals(
            204,
            http(
                    client,
                    base,
                    "DELETE",
                    "/api/v1/documents/" + document,
                    ownerToken,
                    "{\"expectedMetadataRevision\":1}",
                    null)
                .statusCode());
        assertEquals(
            404,
            http(client, base, "GET", "/api/v1/public/shares/" + publicToken, null, null, null)
                .statusCode());
        assertEquals(
            200,
            http(
                    client,
                    base,
                    "POST",
                    "/api/v1/documents/" + document + "/restore",
                    ownerToken,
                    "{\"expectedMetadataRevision\":2}",
                    null)
                .statusCode());
        assertEquals(
            200,
            http(client, base, "GET", "/api/v1/public/shares/" + publicToken, null, null, null)
                .statusCode());
      }
    } finally {
      issuer.stop(0);
    }
  }

  private static String token(RSAKey key, String actor) throws Exception {
    SignedJWT token =
        new SignedJWT(
            new JWSHeader.Builder(JWSAlgorithm.RS256)
                .type(JOSEObjectType.JWT)
                .keyID(key.getKeyID())
                .build(),
            new JWTClaimsSet.Builder()
                .issuer("http://document-http.test")
                .audience("editor-api")
                .subject(actor)
                .issueTime(new Date())
                .expirationTime(Date.from(Instant.now().plusSeconds(600)))
                .build());
    token.sign(new RSASSASigner(key));
    return token.serialize();
  }

  private static HttpResponse<String> http(
      HttpClient client,
      String base,
      String method,
      String path,
      String token,
      String body,
      String idempotency)
      throws Exception {
    HttpRequest.Builder request =
        HttpRequest.newBuilder(URI.create(base + path))
            .method(
                method,
                body == null
                    ? HttpRequest.BodyPublishers.noBody()
                    : HttpRequest.BodyPublishers.ofString(body));
    if (token != null) request.header("Authorization", "Bearer " + token);
    if (body != null) request.header("Content-Type", "application/json");
    if (idempotency != null) request.header("Idempotency-Key", idempotency);
    return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
  }

  @Test
  void orderedOutboxLeaseAckAndRetentionUseActualSql() throws Exception {
    db.update(
        "UPDATE outbox_events SET published_at=? WHERE published_at IS NULL",
        Timestamp.from(Instant.now()));
    String document = doc(),
        upload = upload(owner, document, "mixed-runs.tedoc", 0),
        key = DocumentHarness.uuid();
    commit(owner, document, upload, 0, key);
    JdbcOutbox outbox = new JdbcOutbox(db, new DataSourceTransactionManager(source));
    var first = outbox.claim("owner-a");
    assertNotNull(first);
    assertTrue(EventSchemas.valid(first.topic(), first.payload()));
    assertNull(outbox.claim("owner-b"));
    outbox.retry(first.id(), "owner-a", 1, "BROKER_UNAVAILABLE");
    assertNull(outbox.claim("owner-b"));
    assertNull(
        db.queryForObject(
            "SELECT published_at FROM outbox_events WHERE id=?", Timestamp.class, first.id()));
    db.update(
        "UPDATE outbox_events SET next_attempt_at=? WHERE id=?",
        Timestamp.from(Instant.now().minusSeconds(2)),
        first.id());
    var reclaimed = outbox.claim("owner-b");
    assertEquals(first.id(), reclaimed.id());
    assertEquals(1, reclaimed.previousAttempts());
    outbox.published(first.id(), "owner-a");
    assertNull(
        db.queryForObject(
            "SELECT published_at FROM outbox_events WHERE id=?", Timestamp.class, first.id()));
    outbox.published(first.id(), "owner-b");
    assertNotNull(
        db.queryForObject(
            "SELECT published_at FROM outbox_events WHERE id=?", Timestamp.class, first.id()));
    String second = upload(owner, document, "unicode-uniform.tedoc", 1);
    commit(owner, document, second, 1, DocumentHarness.uuid());
    db.update(
        "UPDATE outbox_events SET published_at=? WHERE id=?",
        Timestamp.from(Instant.now().minusSeconds(604801)),
        first.id());
    db.update(
        "UPDATE outbox_events SET created_at=? WHERE aggregate_id=? AND published_at IS NULL",
        Timestamp.from(Instant.now().minusSeconds(604801)),
        document);
    db.update(
        "UPDATE idempotency_requests SET expires_at=? WHERE actor_user_id=? AND idempotency_key=?",
        Timestamp.from(Instant.now().minusSeconds(1)),
        owner,
        key);
    new JdbcRetention(db, new DataSourceTransactionManager(source)).expireReceipts();
    assertEquals(
        0,
        db.queryForObject(
            "SELECT COUNT(*) FROM outbox_events WHERE id=?", Integer.class, first.id()));
    assertEquals(
        1,
        db.queryForObject(
            "SELECT COUNT(*) FROM outbox_events WHERE aggregate_id=? AND published_at IS NULL",
            Integer.class,
            document));
    assertEquals(
        0,
        db.queryForObject(
            "SELECT COUNT(*) FROM idempotency_requests WHERE actor_user_id=? AND idempotency_key=?",
            Integer.class,
            owner,
            key));
  }

  @Test
  void realStorageNeverExecutesInsideSqlTransactions() throws Exception {
    LocalStorage local = new LocalStorage(temp, "http://localhost:8080");
    AtomicInteger operations = new AtomicInteger();
    StorageProvider checked =
        new StorageProvider() {
          private void outside() {
            assertFalse(
                TransactionSynchronizationManager.isActualTransactionActive(),
                "Storage must execute after SQL transaction completion");
            operations.incrementAndGet();
          }

          public String provider() {
            return local.provider();
          }

          public String bucket() {
            return local.bucket();
          }

          public Upload createUpload(String key, long bytes, String id) throws java.io.IOException {
            outside();
            return local.createUpload(key, bytes, id);
          }

          public Metadata inspect(String key) throws java.io.IOException {
            outside();
            return local.inspect(key);
          }

          public InputStream read(ObjectRef ref) throws java.io.IOException {
            outside();
            return local.read(ref);
          }

          public Metadata writeNew(String key, InputStream input, long bytes, long cap)
              throws java.io.IOException {
            outside();
            return local.writeNew(key, input, bytes, cap);
          }

          public void deleteGeneration(ObjectRef ref) throws java.io.IOException {
            outside();
            local.deleteGeneration(ref);
          }
        };
    s =
        new DocumentHarness(
            db,
            new DataSourceTransactionManager(source),
            checked,
            "http://localhost:8080",
            100,
            100);
    String document = doc(), ticket = upload(owner, document, "mixed-runs.tedoc", 0);
    commit(owner, document, ticket, 0, DocumentHarness.uuid());
    try (InputStream input = s.content(owner, document, 1)) {
      assertTrue(input.read() > 0);
    }
    assertTrue(operations.get() >= 5);
  }
}
