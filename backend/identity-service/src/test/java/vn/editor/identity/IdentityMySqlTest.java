package vn.editor.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.nio.file.Path;
import java.time.Clock;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.mysql.MySQLContainer;
import vn.editor.identity.auth.application.command.AuthenticationSession;
import vn.editor.identity.auth.application.command.LoginCommand;
import vn.editor.identity.auth.application.command.LoginHandler;
import vn.editor.identity.auth.application.command.LogoutCommand;
import vn.editor.identity.auth.application.command.LogoutHandler;
import vn.editor.identity.auth.application.command.RefreshSessionCommand;
import vn.editor.identity.auth.application.command.RefreshSessionHandler;
import vn.editor.identity.auth.application.command.RegisterAccountCommand;
import vn.editor.identity.auth.application.command.RegisterAccountHandler;
import vn.editor.identity.auth.application.command.SessionIssuer;
import vn.editor.identity.auth.application.query.GetProfileHandler;
import vn.editor.identity.auth.application.query.GetProfileQuery;
import vn.editor.identity.auth.application.query.ResolveAccountHandler;
import vn.editor.identity.auth.application.query.ResolveAccountQuery;
import vn.editor.identity.auth.application.query.UserView;
import vn.editor.identity.auth.domain.AuthenticationFailure;
import vn.editor.identity.auth.infrastructure.persistence.JdbcAccountCommands;
import vn.editor.identity.auth.infrastructure.persistence.JdbcAccountReads;
import vn.editor.identity.auth.infrastructure.persistence.JdbcRefreshSessions;
import vn.editor.identity.auth.infrastructure.persistence.SpringTransactions;
import vn.editor.identity.auth.infrastructure.security.Argon2PasswordHashes;
import vn.editor.identity.auth.infrastructure.security.DocumentServiceCaller;
import vn.editor.identity.auth.infrastructure.security.SecureRefreshTokens;
import vn.editor.identity.auth.infrastructure.security.TokenKeys;
import vn.editor.identity.bootstrap.IdentitySecurity;

@Testcontainers
class IdentityMySqlTest {
  @Container static MySQLContainer mysql = new MySQLContainer("mysql:8.4.7");
  @TempDir Path directory;
  JdbcTemplate jdbc;
  RegisterAccountHandler registration;
  LoginHandler login;
  RefreshSessionHandler refresh;
  LogoutHandler logout;

  @BeforeEach
  void setup() throws Exception {
    var source =
        new DriverManagerDataSource(
            mysql.getJdbcUrl()
                + (mysql.getJdbcUrl().contains("?") ? "&" : "?")
                + "connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true",
            mysql.getUsername(),
            mysql.getPassword());
    Flyway.configure().dataSource(source).locations("classpath:db/migration").load().migrate();
    jdbc = new JdbcTemplate(source);
    jdbc.update("DELETE FROM refresh_sessions");
    jdbc.update("DELETE FROM users");
    wire(10);
  }

  void wire(int maximum) throws Exception {
    var accounts = new JdbcAccountCommands(jdbc);
    var sessions = new JdbcRefreshSessions(jdbc);
    var transactions =
        new SpringTransactions(
            new TransactionTemplate(new DataSourceTransactionManager(jdbc.getDataSource())));
    var hashes = new Argon2PasswordHashes(new IdentitySecurity().passwords());
    var tokens = new SecureRefreshTokens();
    var issuer =
        new SessionIssuer(
            sessions, tokens, new TokenKeys(directory.resolve("key.pem").toString(), true, "test"));
    Clock clock = Clock.systemUTC();
    registration = new RegisterAccountHandler(accounts, hashes, transactions, clock, maximum);
    login = new LoginHandler(accounts, hashes, transactions, issuer, clock);
    refresh = new RefreshSessionHandler(accounts, sessions, tokens, transactions, issuer, clock);
    logout = new LogoutHandler(accounts, sessions, tokens, transactions);
  }

  UserView register(String email, String password, String name) {
    return registration.handle(new RegisterAccountCommand(email, password, name));
  }

  AuthenticationSession login(String email, String password) {
    return login.handle(new LoginCommand(email, password));
  }

  AuthenticationSession refresh(String token) {
    return refresh.handle(new RefreshSessionCommand(token));
  }

  void logout(String token) {
    logout.handle(new LogoutCommand(token));
  }

  @Test
  void duplicateEmailRaceHasExactlyOneWinner() throws Exception {
    try (var pool = Executors.newFixedThreadPool(2)) {
      var gate = new CountDownLatch(1);
      List<Future<String>> futures = new ArrayList<>();
      for (int index = 0; index < 2; index++)
        futures.add(
            pool.submit(
                () -> {
                  gate.await();
                  try {
                    register("Race@example.com", "a strong password", "Race");
                    return "REGISTERED";
                  } catch (AuthenticationFailure failure) {
                    return failure.reason().name();
                  }
                }));
      gate.countDown();
      List<String> results = new ArrayList<>();
      for (var result : futures) results.add(result.get());
      Collections.sort(results);
      assertEquals(List.of("EMAIL_ALREADY_REGISTERED", "REGISTERED"), results);
      assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM users", Integer.class));
    }
  }

  @Test
  void refreshReuseRevokesEntireFamilyWithoutExtendingExpiry() {
    UserView user = register("a@example.com", "a strong password", "A");
    assertEquals(
        AuthenticationFailure.Reason.INVALID_CREDENTIALS,
        assertThrows(AuthenticationFailure.class, () -> login(user.email(), "wrong password"))
            .reason());
    var first = login(user.email(), "a strong password");
    var child = refresh(first.refreshToken());
    assertEquals(first.expiresAt(), child.expiresAt());
    assertNotEquals(first.refreshToken(), child.refreshToken());
    assertEquals(
        AuthenticationFailure.Reason.INVALID_CREDENTIALS,
        assertThrows(AuthenticationFailure.class, () -> refresh(first.refreshToken())).reason());
    assertEquals(
        AuthenticationFailure.Reason.INVALID_CREDENTIALS,
        assertThrows(AuthenticationFailure.class, () -> refresh(child.refreshToken())).reason());
    assertEquals(
        0,
        jdbc.queryForObject(
            "SELECT COUNT(*) FROM refresh_sessions WHERE revoked_at IS NULL", Integer.class));
    assertEquals(
        0,
        jdbc.queryForObject(
            "SELECT COUNT(*) FROM refresh_sessions WHERE token_sha256=?",
            Integer.class,
            first.refreshToken()));
  }

  @Test
  void logoutRevokesDescendantsAndExpiredRefreshFails() {
    register("a@example.com", "a strong password", "A");
    var first = login("a@example.com", "a strong password");
    var child = refresh(first.refreshToken());
    logout(first.refreshToken());
    assertThrows(AuthenticationFailure.class, () -> refresh(child.refreshToken()));
    var next = login("a@example.com", "a strong password");
    jdbc.update(
        "UPDATE refresh_sessions SET expires_at=UTC_TIMESTAMP(6)-INTERVAL 1 SECOND WHERE token_sha256=?",
        SecureRefreshTokens.sha256(next.refreshToken()));
    assertThrows(AuthenticationFailure.class, () -> refresh(next.refreshToken()));
  }

  @Test
  void concurrentRefreshOnlyMintsOneChildThenRevokesFamily() throws Exception {
    register("a@example.com", "a strong password", "A");
    var first = login("a@example.com", "a strong password");
    try (var pool = Executors.newFixedThreadPool(2)) {
      var gate = new CountDownLatch(1);
      List<Future<String>> futures = new ArrayList<>();
      for (int index = 0; index < 2; index++)
        futures.add(
            pool.submit(
                () -> {
                  gate.await();
                  try {
                    refresh(first.refreshToken());
                    return "ROTATED";
                  } catch (AuthenticationFailure failure) {
                    return failure.reason().name();
                  }
                }));
      gate.countDown();
      List<String> results = new ArrayList<>();
      for (var result : futures) results.add(result.get());
      Collections.sort(results);
      assertEquals(List.of("INVALID_CREDENTIALS", "ROTATED"), results);
      assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM refresh_sessions", Integer.class));
      assertEquals(
          0,
          jdbc.queryForObject(
              "SELECT COUNT(*) FROM refresh_sessions WHERE revoked_at IS NULL", Integer.class));
    }
  }

  @Test
  void fullQuotaStillIdentifiesExistingAccountWithoutAddingUsers() throws Exception {
    wire(1);
    register("one@example.com", "a strong password", "One");
    assertEquals(
        AuthenticationFailure.Reason.EMAIL_ALREADY_REGISTERED,
        assertThrows(
                AuthenticationFailure.class,
                () -> register("ONE@example.com", "a strong password", "One"))
            .reason());
    assertEquals(
        AuthenticationFailure.Reason.ACCOUNT_QUOTA,
        assertThrows(
                AuthenticationFailure.class,
                () -> register("two@example.com", "a strong password", "Two"))
            .reason());
    assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM users", Integer.class));
  }

  @Test
  void readPortsExposeOnlyPublicProfileAndInternalResolutionRequiresDocumentCaller() {
    UserView user = register("Reader@example.com", "a strong password", "Reader");
    var reads = new JdbcAccountReads(jdbc);
    var profile = new GetProfileHandler(reads);
    assertEquals(user, profile.handle(new GetProfileQuery(user.id())));
    var resolve = new ResolveAccountHandler(reads, new DocumentServiceCaller("document-key"));
    assertEquals(
        user, resolve.handle(new ResolveAccountQuery("READER@example.com", "document-key", true)));
    assertEquals(
        AuthenticationFailure.Reason.INVALID_SERVICE_CALLER,
        assertThrows(
                AuthenticationFailure.class,
                () -> resolve.handle(new ResolveAccountQuery(user.id(), "wrong-key", false)))
            .reason());
    assertEquals(
        AuthenticationFailure.Reason.USER_NOT_REGISTERED,
        assertThrows(
                AuthenticationFailure.class,
                () ->
                    resolve.handle(
                        new ResolveAccountQuery("absent@example.com", "document-key", true)))
            .reason());
  }
}
