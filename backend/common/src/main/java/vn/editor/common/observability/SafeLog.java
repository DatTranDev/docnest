package vn.editor.common.observability;

import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Fixed actions and allowlisted scalar identifiers only. No paths, payloads, or exceptions. */
public final class SafeLog {
  private static final Logger LOG = LoggerFactory.getLogger(SafeLog.class);

  public enum Action {
    HTTP_REQUEST,
    EVENT_CONSUMED,
    EVENT_PUBLISHED,
    DLQ_PUBLISHED,
    JOB_ATTEMPT_FINISHED,
    INVALID_EVENT
  }

  public static void record(
      String service,
      Action action,
      String documentId,
      String jobId,
      String eventId,
      Long revision,
      long elapsedMs,
      int status) {
    LOG.atInfo()
        .addKeyValue("service", service)
        .addKeyValue("documentId", identifier(documentId))
        .addKeyValue("jobId", identifier(jobId))
        .addKeyValue("eventId", identifier(eventId))
        .addKeyValue("revision", revision != null && revision > 0 ? revision : null)
        .addKeyValue("elapsedMs", Math.max(0, elapsedMs))
        .addKeyValue("status", status)
        .log(action.name());
  }

  private static String identifier(String value) {
    if (value == null) return null;
    try {
      return UUID.fromString(value).toString();
    } catch (IllegalArgumentException invalid) {
      return null;
    }
  }

  public static void invalidEvent(String service, String raw, int partition, long offset) {
    String hash;
    try {
      hash =
          java.util.HexFormat.of()
              .formatHex(
                  java.security.MessageDigest.getInstance("SHA-256")
                      .digest(
                          (raw == null ? "" : raw)
                              .getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    } catch (java.security.NoSuchAlgorithmException unavailable) {
      throw new IllegalStateException("SHA256_UNAVAILABLE");
    }
    LOG.atWarn()
        .addKeyValue("service", service)
        .addKeyValue("payloadSha256", hash)
        .addKeyValue("partition", partition)
        .addKeyValue("offset", offset)
        .log(Action.INVALID_EVENT.name());
  }

  private SafeLog() {}
}
