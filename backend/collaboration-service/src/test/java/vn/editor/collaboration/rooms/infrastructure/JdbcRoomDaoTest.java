package vn.editor.collaboration.rooms.infrastructure;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.mysql.MySQLContainer;
import vn.editor.collaboration.rooms.domain.RoomFailure;
import vn.editor.collaboration.rooms.domain.RoomPolicy;

@Testcontainers
class JdbcRoomDaoTest {
  @Container static MySQLContainer mysql = new MySQLContainer("mysql:8.4.7");
  JdbcRoomDao store;
  JdbcTemplate jdbc;
  TransactionTemplate transactions;

  @BeforeEach
  void setup() {
    var source =
        new DriverManagerDataSource(mysql.getJdbcUrl(), mysql.getUsername(), mysql.getPassword());
    Flyway.configure().dataSource(source).load().migrate();
    jdbc = new JdbcTemplate(source);
    transactions = new TransactionTemplate(new DataSourceTransactionManager(source));
    store = new JdbcRoomDao(jdbc, transactions);
  }

  @Test
  void concurrentJoinCreatesOneSeedAndSurvivesRepositoryRestart() throws Exception {
    UUID id = UUID.randomUUID();
    try (var executor = Executors.newFixedThreadPool(8)) {
      var tasks = new ArrayList<Callable<Long>>();
      for (int i = 0; i < 16; i++) tasks.add(() -> store.join(id, 3, new byte[] {1, 2}).sequence());
      for (var future : executor.invokeAll(tasks)) assertEquals(1L, future.get());
    }
    var reconnected = new JdbcRoomDao(jdbc, transactions);
    assertArrayEquals(new byte[] {1, 2}, reconnected.read(id, 0).updates().getFirst().payload());
    assertEquals(
        1,
        jdbc.queryForObject(
            "SELECT COUNT(*) FROM collaboration_updates WHERE document_id=?",
            Integer.class,
            id.toString()));
  }

  @Test
  void concurrentAppendHasTotalOrderAndIdempotentRetries() throws Exception {
    UUID id = UUID.randomUUID(), user = UUID.randomUUID(), operation = UUID.randomUUID();
    store.join(id, 0, new byte[] {1});
    try (var executor = Executors.newFixedThreadPool(8)) {
      var tasks = new ArrayList<Callable<Long>>();
      for (int i = 0; i < 16; i++)
        tasks.add(() -> store.append(id, operation, user, new byte[] {2}));
      for (var future : executor.invokeAll(tasks)) assertEquals(2L, future.get());
      tasks.clear();
      for (int i = 0; i < 16; i++)
        tasks.add(() -> store.append(id, UUID.randomUUID(), user, new byte[] {3}));
      var sequences = new HashSet<Long>();
      for (var future : executor.invokeAll(tasks)) sequences.add(future.get());
      assertEquals(16, sequences.size());
      assertEquals(18, store.read(id, 0).sequence());
    }
    assertThrows(RoomFailure.class, () -> store.append(id, operation, user, new byte[] {9}));
    assertThrows(
        RoomFailure.class, () -> store.append(id, operation, UUID.randomUUID(), new byte[] {2}));
  }

  @Test
  void checkpointLocksOnlyMatchingClockAndLogQuotaRollsBack() {
    UUID id = UUID.randomUUID(), lease = UUID.randomUUID(), user = UUID.randomUUID();
    store.join(id, 5, new byte[] {1});
    assertThrows(RoomFailure.class, () -> store.reserveCheckpoint(id, 0, lease));
    assertEquals(5, store.reserveCheckpoint(id, 1, lease));
    assertThrows(
        RoomFailure.class, () -> store.append(id, UUID.randomUUID(), user, new byte[] {2}));
    store.finishCheckpoint(id, lease, 6);
    assertEquals(6, store.read(id, 0).headRevision());
    store.append(id, UUID.randomUUID(), user, new byte[] {2});
    jdbc.update(
        "UPDATE collaboration_rooms SET log_bytes=? WHERE document_id=?",
        RoomPolicy.MAX_LOG_BYTES,
        id.toString());
    assertThrows(
        RoomFailure.class, () -> store.append(id, UUID.randomUUID(), user, new byte[] {3}));
    assertEquals(2, store.read(id, 0).sequence());
  }
}
