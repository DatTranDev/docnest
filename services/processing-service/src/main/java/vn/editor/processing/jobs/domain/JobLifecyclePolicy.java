package vn.editor.processing.jobs.domain;

import java.time.Instant;
import java.util.Objects;
import java.util.Set;

public final class JobLifecyclePolicy {
  public static final int MAX_ATTEMPTS = 3;

  public static boolean terminal(String state) {
    return Set.of("SUCCEEDED", "FAILED", "CANCELLED").contains(state);
  }

  public static boolean ownsLiveLease(
      String state, String expectedOwner, String actualOwner, Instant expiry, Instant now) {
    return "RUNNING".equals(state)
        && Objects.equals(expectedOwner, actualOwner)
        && expiry != null
        && expiry.isAfter(now);
  }

  public static boolean retryAllowed(
      boolean transientFailure, boolean cancelled, int attempts, Instant deadline, Instant now) {
    return transientFailure && !cancelled && attempts < MAX_ATTEMPTS && deadline.isAfter(now);
  }

  public static int retryDelaySeconds(int attempt) {
    return attempt == 1 ? 5 : 30;
  }

  public static void requireDownload(
      String state, boolean hasResult, Instant expires, Instant now) {
    if (!"SUCCEEDED".equals(state))
      throw new JobPolicyViolation("JOB_NOT_READY", "Result is not ready");
    if (!hasResult || expires == null || !expires.isAfter(now))
      throw new JobPolicyViolation("RESULT_EXPIRED", "Export result has expired");
  }

  private JobLifecyclePolicy() {}
}
