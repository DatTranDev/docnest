package vn.editor.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.mysql.MySQLContainer;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import vn.editor.identity.bootstrap.IdentityApplication;

/** Starts the real production bootstrap and exercises authentication through actual HTTP. */
@Testcontainers
class IdentityBootstrapTest {
  @Container static MySQLContainer mysql = new MySQLContainer("mysql:8.4.7");

  @Container
  static GenericContainer<?> redis =
      new GenericContainer<>("redis:8.4.0-alpine").withExposedPorts(6379);

  private static final ObjectMapper JSON = new ObjectMapper();
  private static final String ORIGIN = "http://editor.test";
  private static final Path KEY =
      Path.of(
          System.getProperty("java.io.tmpdir"), "identity-bootstrap-" + UUID.randomUUID() + ".pem");
  private static ConfigurableApplicationContext context;
  private static String base;

  @BeforeAll
  static void start() {
    context =
        SpringApplication.run(
            IdentityApplication.class,
            "--server.port=0",
            "--spring.kafka.listener.auto-startup=false",
            "--spring.kafka.bootstrap-servers=127.0.0.1:1",
            "--spring.kafka.producer.properties.max.block.ms=100",
            "--spring.datasource.url="
                + mysql.getJdbcUrl()
                + (mysql.getJdbcUrl().contains("?") ? "&" : "?")
                + "connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true",
            "--spring.datasource.username=" + mysql.getUsername(),
            "--spring.datasource.password=" + mysql.getPassword(),
            "--spring.data.redis.host=" + redis.getHost(),
            "--spring.data.redis.port=" + redis.getMappedPort(6379),
            "--editor.jwt.issuer=" + ORIGIN,
            "--editor.jwt.key-path=" + KEY,
            "--editor.jwt.allow-key-generation=true",
            "--editor.auth.secure-cookies=false",
            "--editor.auth.origins=" + ORIGIN,
            "--editor.auth.document-internal-key=document-bootstrap-key",
            "--logging.level.root=WARN",
            "--logging.level.vn.editor.common.observability.SafeLog=INFO");
    base = "http://127.0.0.1:" + context.getEnvironment().getRequiredProperty("local.server.port");
  }

  @AfterAll
  static void stop() throws Exception {
    if (context != null) context.close();
    Files.deleteIfExists(KEY);
  }

  @Test
  void productionWiringPreservesHttpContractsCsrfRotationQueriesAndLogout() throws Exception {
    var cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
    var client = HttpClient.newBuilder().cookieHandler(cookies).build();
    var csrfResponse =
        client.send(
            HttpRequest.newBuilder(URI.create(base + "/api/v1/auth/csrf")).GET().build(),
            HttpResponse.BodyHandlers.ofString());
    assertEquals(200, csrfResponse.statusCode());
    assertTrue(
        csrfResponse.headers().firstValue("X-Trace-Id").orElseThrow().matches("[0-9a-f]{32}"));
    String csrf = JSON.readTree(csrfResponse.body()).path("token").asString();
    Map<String, Object> registration =
        Map.of(
            "email",
            "BOOTSTRAP@example.com",
            "password",
            "a strong password",
            "displayName",
            "Bootstrap");
    var forbidden =
        post(client, "/api/v1/auth/register", registration, csrf, "http://attacker.test");
    assertEquals(403, forbidden.statusCode());
    assertEquals("a".repeat(32), forbidden.headers().firstValue("X-Trace-Id").orElseThrow());
    assertEquals("a".repeat(32), JSON.readTree(forbidden.body()).path("traceId").asString());
    var registered = post(client, "/api/v1/auth/register", registration, csrf, ORIGIN);
    assertEquals(201, registered.statusCode(), registered.body());
    var profile = JSON.readTree(registered.body());
    assertEquals("bootstrap@example.com", profile.path("email").asString());
    assertFalse(profile.has("passwordHash"));
    var loggedIn =
        post(
            client,
            "/api/v1/auth/login",
            Map.of("email", "bootstrap@example.com", "password", "a strong password"),
            csrf,
            ORIGIN);
    assertEquals(200, loggedIn.statusCode(), loggedIn.body());
    JsonNode session = JSON.readTree(loggedIn.body());
    assertEquals("Bearer", session.path("tokenType").asString());
    assertEquals(600, session.path("expiresIn").asInt());
    assertEquals(profile, session.path("user"));
    assertEquals("no-store", loggedIn.headers().firstValue("Cache-Control").orElseThrow());
    String accessToken = session.path("accessToken").asString();
    String firstRefresh =
        cookies.getCookieStore().getCookies().stream()
            .filter(cookie -> cookie.getName().equals("refresh_token"))
            .findFirst()
            .orElseThrow()
            .getValue();
    var me = get(client, "/api/v1/auth/me", accessToken, null);
    assertEquals(200, me.statusCode());
    assertEquals(profile, JSON.readTree(me.body()));
    var internal =
        get(
            client,
            "/internal/v1/users/" + profile.path("id").asString(),
            accessToken,
            "document-bootstrap-key");
    assertEquals(200, internal.statusCode());
    assertEquals(profile, JSON.readTree(internal.body()));
    assertEquals(
        403,
        get(client, "/internal/v1/users/" + profile.path("id").asString(), accessToken, "wrong-key")
            .statusCode());
    var keys = get(client, "/.well-known/jwks.json", null, null);
    assertEquals(200, keys.statusCode());
    assertEquals("RSA", JSON.readTree(keys.body()).path("keys").get(0).path("kty").asString());
    var rotated = post(client, "/api/v1/auth/refresh", Map.of(), csrf, ORIGIN);
    assertEquals(200, rotated.statusCode(), rotated.body());
    String childRefresh =
        cookies.getCookieStore().getCookies().stream()
            .filter(cookie -> cookie.getName().equals("refresh_token"))
            .findFirst()
            .orElseThrow()
            .getValue();
    assertNotEquals(firstRefresh, childRefresh);
    assertEquals(204, post(client, "/api/v1/auth/logout", Map.of(), csrf, ORIGIN).statusCode());
    assertEquals(401, post(client, "/api/v1/auth/refresh", Map.of(), csrf, ORIGIN).statusCode());
    assertTrue(Files.size(KEY) > 0);
  }

  private static HttpResponse<String> post(
      HttpClient client, String path, Map<String, Object> body, String csrf, String origin)
      throws Exception {
    return client.send(
        HttpRequest.newBuilder(URI.create(base + path))
            .header("X-Trace-Id", "a".repeat(32))
            .header("Content-Type", "application/json")
            .header("Origin", origin)
            .header("X-CSRF-TOKEN", csrf)
            .POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body)))
            .build(),
        HttpResponse.BodyHandlers.ofString());
  }

  private static HttpResponse<String> get(
      HttpClient client, String path, String token, String internalKey) throws Exception {
    var request = HttpRequest.newBuilder(URI.create(base + path)).GET();
    if (token != null) request.header("Authorization", "Bearer " + token);
    if (internalKey != null) request.header("X-Internal-Key", internalKey);
    return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
  }
}
