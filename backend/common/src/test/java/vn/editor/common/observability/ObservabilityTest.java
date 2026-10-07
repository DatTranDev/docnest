package vn.editor.common.observability;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

class ObservabilityTest {
  @Test
  void acceptsOnlyBoundedValidCorrelationAndW3cHeaders() {
    String trace = "a".repeat(32);
    assertEquals(trace, TraceContext.incoming("00-" + trace + "-" + "b".repeat(16) + "-01", null));
    assertEquals(trace, TraceContext.incoming(null, trace));
    for (String invalid : new String[] {"0".repeat(32), "PASSWORD\nINJECTED", "a".repeat(10000)})
      assertTrue(TraceContext.normalize(invalid).matches("[0-9a-f]{32}"));
    assertFalse(TraceContext.normalize("0".repeat(32)).equals("0".repeat(32)));
  }

  @Test
  void nestedScopesRestoreAndThreadPoolsNeverInheritPrivateRequestContext() throws Exception {
    assertNull(TraceContext.requestId());
    try (var outer = TraceContext.open("a".repeat(32), "c".repeat(32))) {
      assertEquals("a".repeat(32), TraceContext.traceId());
      try (var inner = TraceContext.open("b".repeat(32), null)) {
        assertEquals("b".repeat(32), TraceContext.traceId());
      }
      assertEquals("a".repeat(32), TraceContext.traceId());
      try (var pool = Executors.newSingleThreadExecutor()) {
        assertNull(pool.submit(TraceContext::requestId).get());
      }
    }
    assertNull(TraceContext.requestId());
  }

  @Test
  void structuredOperatorLogNeverContainsInvalidRawPayloadOrIdentifiers() {
    Logger logger = (Logger) LoggerFactory.getLogger(SafeLog.class);
    ListAppender<ILoggingEvent> captured = new ListAppender<>();
    captured.start();
    logger.addAppender(captured);
    try (var scope = TraceContext.open("a".repeat(32), "c".repeat(32))) {
      SafeLog.record(
          "processing-service",
          SafeLog.Action.HTTP_REQUEST,
          "PRIVATE_EMAIL",
          "SECRET_TOKEN",
          null,
          1L,
          5,
          422);
      SafeLog.invalidEvent("processing-service", "{\"password\":\"PRIVATE_PASSWORD\"}", 2, 42);
      assertEquals(2, captured.list.size());
      for (var event : captured.list) {
        String rendered = event.getFormattedMessage() + event.getKeyValuePairs().toString();
        assertFalse(rendered.contains("PRIVATE_EMAIL"));
        assertFalse(rendered.contains("SECRET_TOKEN"));
        assertFalse(rendered.contains("PRIVATE_PASSWORD"));
        assertEquals("a".repeat(32), event.getMDCPropertyMap().get("traceId"));
        assertEquals("c".repeat(32), event.getMDCPropertyMap().get("requestId"));
        assertFalse(
            event.getKeyValuePairs().stream()
                .anyMatch(pair -> pair.key.equals("traceId") || pair.key.equals("requestId")));
      }
      assertTrue(
          captured.list.get(1).getKeyValuePairs().stream()
              .anyMatch(
                  pair ->
                      pair.key.equals("payloadSha256")
                          && pair.value.toString().matches("[0-9a-f]{64}")));
    } finally {
      logger.detachAppender(captured);
      captured.stop();
    }
  }
}
