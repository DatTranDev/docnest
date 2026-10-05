package vn.editor.processing.jobs.domain;

public final class JobQuotaPolicy {
  public static void requireCapacity(long active, int limit) {
    if (active >= limit)
      throw new JobPolicyViolation("QUOTA_EXCEEDED", "Active export job quota reached");
  }

  private JobQuotaPolicy() {}
}
