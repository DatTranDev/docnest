package vn.editor.common.observability;

import java.util.Map;
import java.util.UUID;
import org.slf4j.MDC;

/** Technical correlation context; never contains actor identity, credentials, or document text. */
public final class TraceContext {
  private static final ThreadLocal<Ids> CURRENT = new ThreadLocal<>();

  private record Ids(String requestId, String traceId) {}

  public static String freshTraceId() {
    return UUID.randomUUID().toString().replace("-", "");
  }

  public static String normalize(String candidate) {
    return candidate != null
            && candidate.matches("[0-9a-f]{32}")
            && !candidate.equals("0".repeat(32))
        ? candidate
        : freshTraceId();
  }

  public static String incoming(String traceparent, String traceId) {
    if (traceparent != null
        && traceparent.matches("00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}")
        && !traceparent.substring(36, 52).equals("0".repeat(16)))
      return normalize(traceparent.substring(3, 35));
    return normalize(traceId);
  }

  public static String traceId() {
    Ids ids = CURRENT.get();
    return ids == null ? freshTraceId() : ids.traceId();
  }

  public static String requestId() {
    Ids ids = CURRENT.get();
    return ids == null ? null : ids.requestId();
  }

  public static Scope open(String traceId, String requestId) {
    Ids previous = CURRENT.get();
    Map<String, String> previousMdc = MDC.getCopyOfContextMap();
    Ids next =
        new Ids(requestId == null ? freshTraceId() : normalize(requestId), normalize(traceId));
    CURRENT.set(next);
    MDC.put("traceId", next.traceId());
    MDC.put("requestId", next.requestId());
    return () -> {
      if (previous == null) CURRENT.remove();
      else CURRENT.set(previous);
      if (previousMdc == null) MDC.clear();
      else MDC.setContextMap(previousMdc);
    };
  }

  public interface Scope extends AutoCloseable {
    @Override
    void close();
  }

  private TraceContext() {}
}
