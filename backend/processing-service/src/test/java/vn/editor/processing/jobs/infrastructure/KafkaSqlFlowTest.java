package vn.editor.processing.jobs.infrastructure;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.apache.kafka.clients.admin.AdminClient;
import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.apache.kafka.common.serialization.StringSerializer;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.aop.support.AopUtils;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.kafka.core.DefaultKafkaConsumerFactory;
import org.springframework.kafka.core.DefaultKafkaProducerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.kafka.KafkaContainer;
import org.testcontainers.mysql.MySQLContainer;
import vn.editor.common.observability.TraceContext;
import vn.editor.processing.bootstrap.KafkaErrorConfig;

@Testcontainers
class KafkaSqlFlowTest {
  @Container static MySQLContainer mysql = new MySQLContainer("mysql:8.4.7");

  @Container
  static KafkaContainer broker =
      new KafkaContainer("apache/kafka:4.1.1").withEnv("KAFKA_HEAP_OPTS", "-Xms128m -Xmx384m");

  JdbcTemplate db;
  JdbcJobDao jobs;
  ProcessingEvents events;
  KafkaWorkflow flow;
  KafkaTemplate<String, String> producer;
  DefaultKafkaProducerFactory<String, String> factory;
  TransactionTemplate tx;
  AnnotationConfigApplicationContext context;

  @BeforeEach
  void setup() throws Exception {
    var data =
        new DriverManagerDataSource(mysql.getJdbcUrl(), mysql.getUsername(), mysql.getPassword());
    Flyway.configure().dataSource(data).locations("classpath:db/migration").load().migrate();
    db = new JdbcTemplate(data);
    for (String table :
        List.of(
            "output_attempts",
            "inbox_receipts",
            "outbox_events",
            "idempotency_requests",
            "jobs",
            "requester_queues")) db.update("DELETE FROM " + table);
    var json = new ObjectMapper();
    events = new ProcessingEvents(json);
    tx = new TransactionTemplate(new DataSourceTransactionManager(data));
    context = ProcessingRepositoryContext.create(db, tx, events, json);
    jobs = context.getBean(JdbcJobDao.class);
    assertTrue(AopUtils.isCglibProxy(jobs));
    Map<String, Object> config = new HashMap<>();
    config.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, broker.getBootstrapServers());
    config.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
    config.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
    config.put(ProducerConfig.ACKS_CONFIG, "all");
    config.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
    config.put(ProducerConfig.REQUEST_TIMEOUT_MS_CONFIG, 500);
    config.put(ProducerConfig.DELIVERY_TIMEOUT_MS_CONFIG, 1000);
    config.put(ProducerConfig.MAX_BLOCK_MS_CONFIG, 1000);
    factory = new DefaultKafkaProducerFactory<>(config);
    producer = new KafkaTemplate<>(factory);
    producer.setProducerListener(
        new org.springframework.kafka.support.ProducerListener<String, String>() {});
    flow = new KafkaWorkflow(jobs, events, producer, db, tx);
    try (var admin =
        AdminClient.create(Map.of("bootstrap.servers", broker.getBootstrapServers()))) {
      List<NewTopic> topics = new ArrayList<>();
      for (String topic :
          List.of(
              "processing.job.requested.v1", "document.version.saved.v1", "editor.dead-letter.v1"))
        topics.add(new NewTopic(topic, 3, (short) 1));
      try {
        admin.createTopics(topics).all().get(10, TimeUnit.SECONDS);
      } catch (java.util.concurrent.ExecutionException e) {
        if (!(e.getCause() instanceof org.apache.kafka.common.errors.TopicExistsException)) throw e;
      }
    }
  }

  @AfterEach
  void close() {
    factory.destroy();
    context.close();
  }

  KafkaConsumer<String, String> consumer(String topic) {
    var c =
        new KafkaConsumer<String, String>(
            Map.of(
                "bootstrap.servers",
                broker.getBootstrapServers(),
                "group.id",
                UUID.randomUUID().toString(),
                "auto.offset.reset",
                "earliest",
                "enable.auto.commit",
                false,
                "key.deserializer",
                StringDeserializer.class,
                "value.deserializer",
                StringDeserializer.class));
    c.subscribe(List.of(topic));
    return c;
  }

  String enqueue() {
    String id = UUID.randomUUID().toString(),
        doc = UUID.randomUUID().toString(),
        user = UUID.randomUUID().toString();
    tx.executeWithoutResult(
        t -> {
          jobs.insert(
              id,
              doc,
              1,
              user,
              "EXPORT_TXT",
              false,
              null,
              "QUEUED",
              "{\"provider\":\"LOCAL\",\"bucket\":null,\"key\":\"snapshots/a/b.tedoc\",\"generation\":\"1\"}",
              "a".repeat(64));
          events.insert(
              db,
              "processing.job.requested.v1",
              doc,
              1,
              events.envelope(
                  "JobRequested", Map.of("jobId", id, "documentId", doc, "revision", 1)));
        });
    return id;
  }

  @Test
  void originTraceSurvivesActualOutboxAndKafkaConsumer() throws Exception {
    String trace = "b".repeat(32), id;
    try (TraceContext.Scope scope = TraceContext.open(trace, null)) {
      id = enqueue();
    }
    flow.relay();
    assertEquals(trace, jobs.row(id).get("trace_id"));
    boolean consumed = false;
    try (var c = consumer("processing.job.requested.v1")) {
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
      while (!consumed && System.nanoTime() < deadline)
        for (var record : c.poll(Duration.ofMillis(500))) {
          Map<String, Object> event = events.parse(record.topic(), record.value());
          Map<String, Object> payload = (Map<String, Object>) event.get("payload");
          if (!id.equals(payload.get("jobId"))) continue;
          assertEquals(trace, event.get("traceId"));
          flow.requested(record, c::commitSync);
          consumed = true;
        }
    }
    assertTrue(consumed);
    assertEquals("READY", jobs.row(id).get("state"));
    assertNull(TraceContext.requestId());
  }

  @Test
  void crashAfterBrokerAckRedeliversStableEventButInboxMutatesOnce() throws Exception {
    String id = enqueue();
    flow.relay();
    assertEquals(
        0,
        db.queryForObject(
            "SELECT COUNT(*) FROM outbox_events WHERE published_at IS NULL", Integer.class));
    db.update("UPDATE outbox_events SET published_at=NULL");
    flow.relay();
    int deliveries = 0;
    Set<String> ids = new HashSet<>();
    try (var c = consumer("processing.job.requested.v1")) {
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
      while (deliveries < 2 && System.nanoTime() < deadline) {
        for (var record : c.poll(Duration.ofMillis(500))) {
          Map<String, Object> event = events.parse(record.topic(), record.value());
          Map<String, Object> payload = (Map<String, Object>) event.get("payload");
          if (!id.equals(payload.get("jobId"))) continue;
          ids.add((String) event.get("eventId"));
          flow.requested(record, c::commitSync);
          deliveries++;
        }
      }
    }
    assertEquals(2, deliveries);
    assertEquals(1, ids.size());
    assertEquals("READY", jobs.row(id).get("state"));
    assertEquals(1, db.queryForObject("SELECT COUNT(*) FROM inbox_receipts", Integer.class));
  }

  @Test
  void malformedPayloadIsRedactedBeforeRealDlqPublish() throws Exception {
    producer
        .send(
            "document.version.saved.v1", "RAW_PRIVATE_TOKEN", "{\"password\":\"PRIVATE_PASSWORD\"}")
        .get(5, TimeUnit.SECONDS);
    try (var source = consumer("document.version.saved.v1")) {
      boolean handled = false;
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
      while (!handled && System.nanoTime() < deadline)
        for (var record : source.poll(Duration.ofMillis(500))) {
          flow.preview(record, source::commitSync);
          handled = true;
        }
      assertTrue(handled);
    }
    try (var dlq = consumer("editor.dead-letter.v1")) {
      Map<String, Object> message = null;
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
      while (message == null && System.nanoTime() < deadline)
        for (var record : dlq.poll(Duration.ofMillis(500))) {
          message = events.parse(record.topic(), record.value());
          assertFalse(record.value().contains("PRIVATE_PASSWORD"));
          assertFalse(record.value().contains("RAW_PRIVATE_TOKEN"));
        }
      assertNotNull(message);
      Map<String, Object> p = (Map<String, Object>) message.get("payload");
      assertEquals("", p.get("originalPayloadBase64"));
      assertNull(p.get("originalKey"));
      assertEquals("INVALID_SCHEMA_REDACTED", p.get("reason"));
    }
  }

  @Test
  void brokerOutageLeavesSqlJobAndUnsentOutboxDurable() throws Exception {
    String first = enqueue();
    flow.relay();
    broker.getDockerClient().pauseContainerCmd(broker.getContainerId()).exec();
    String id;
    try {
      id = enqueue();
      flow.relay();
      assertEquals("QUEUED", jobs.row(id).get("state"));
      assertEquals(
          1,
          db.queryForObject(
              "SELECT COUNT(*) FROM outbox_events WHERE published_at IS NULL", Integer.class));
    } finally {
      broker.getDockerClient().unpauseContainerCmd(broker.getContainerId()).exec();
    }
    assertEquals("QUEUED", jobs.row(first).get("state"));
  }

  @Test
  void unavailableDlqKeepsOriginalUncommittedUntilBrokerRecovers() throws Exception {
    new KafkaErrorConfig().safeRecordFormatters();
    String group = "dlq-retention-" + UUID.randomUUID();
    Map<String, Object> failedConfig = new HashMap<>();
    failedConfig.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:1");
    failedConfig.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
    failedConfig.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
    failedConfig.put(ProducerConfig.MAX_BLOCK_MS_CONFIG, 1000);
    failedConfig.put(ProducerConfig.DELIVERY_TIMEOUT_MS_CONFIG, 1000);
    failedConfig.put(ProducerConfig.REQUEST_TIMEOUT_MS_CONFIG, 500);
    var unavailableFactory = new DefaultKafkaProducerFactory<String, String>(failedConfig);
    var unavailable = new KafkaTemplate<String, String>(unavailableFactory);
    unavailable.setProducerListener(
        new org.springframework.kafka.support.ProducerListener<String, String>() {});
    var retryFlow = new KafkaWorkflow(jobs, events, unavailable, db, tx);
    Map<String, Object> consumeConfig = new HashMap<>();
    consumeConfig.put("bootstrap.servers", broker.getBootstrapServers());
    consumeConfig.put("group.id", group);
    consumeConfig.put("auto.offset.reset", "latest");
    consumeConfig.put("enable.auto.commit", false);
    consumeConfig.put("key.deserializer", StringDeserializer.class);
    consumeConfig.put("value.deserializer", StringDeserializer.class);
    var properties =
        new org.springframework.kafka.listener.ContainerProperties("document.version.saved.v1");
    properties.setAckMode(
        org.springframework.kafka.listener.ContainerProperties.AckMode.MANUAL_IMMEDIATE);
    properties.setPollTimeout(200);
    var errors = new java.util.concurrent.atomic.AtomicInteger();
    properties.setMessageListener(
        (org.springframework.kafka.listener.AcknowledgingMessageListener<String, String>)
            (record, ack) -> {
              try {
                retryFlow.preview(record, ack);
              } catch (Exception e) {
                errors.incrementAndGet();
                throw new org.springframework.kafka.KafkaException("DLQ_UNAVAILABLE");
              }
            });
    var container =
        new org.springframework.kafka.listener.KafkaMessageListenerContainer<String, String>(
            new DefaultKafkaConsumerFactory<>(consumeConfig), properties);
    container.setCommonErrorHandler(new KafkaErrorConfig().kafkaErrorHandler());
    try (var admin =
        AdminClient.create(Map.of("bootstrap.servers", broker.getBootstrapServers()))) {
      container.start();
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
      while ((container.getAssignedPartitions() == null
              || container.getAssignedPartitions().isEmpty())
          && System.nanoTime() < deadline) Thread.sleep(100);
      assertFalse(container.getAssignedPartitions().isEmpty());
      var metadata =
          producer
              .send(
                  "document.version.saved.v1",
                  "RAW_KEY_DO_NOT_LOG",
                  "{\"password\":\"PRIVATE_SECRET_DO_NOT_LOG\"}")
              .get(5, TimeUnit.SECONDS)
              .getRecordMetadata();
      var partition =
          new org.apache.kafka.common.TopicPartition(metadata.topic(), metadata.partition());
      deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
      while (errors.get() < 2 && System.nanoTime() < deadline) Thread.sleep(100);
      assertTrue(errors.get() >= 2);
      var offsets =
          admin
              .listConsumerGroupOffsets(group)
              .partitionsToOffsetAndMetadata()
              .get(5, TimeUnit.SECONDS);
      assertTrue(
          offsets.get(partition) == null || offsets.get(partition).offset() <= metadata.offset());
      unavailableFactory.updateConfigs(
          Map.of(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, broker.getBootstrapServers()));
      unavailableFactory.reset();
      deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
      boolean committed = false;
      while (!committed && System.nanoTime() < deadline) {
        offsets =
            admin
                .listConsumerGroupOffsets(group)
                .partitionsToOffsetAndMetadata()
                .get(5, TimeUnit.SECONDS);
        committed =
            offsets.get(partition) != null && offsets.get(partition).offset() > metadata.offset();
        if (!committed) Thread.sleep(100);
      }
      assertTrue(committed, "Original advances only after durable DLQ acknowledgement");
    } finally {
      container.stop();
      unavailableFactory.destroy();
    }
  }
}
