package vn.editor.processing.jobs.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class JobPolicyTest {
  @Test
  void validCanonicalRequestsHashIdenticallyAndBoundsRejectAtomically() {
    String id = UUID.randomUUID().toString();
    var first = new ExportRequest(id, 1, "EXPORT_HTML");
    assertEquals(
        first.bodyHash(), new ExportRequest(id.toUpperCase(), 1, "EXPORT_HTML").bodyHash());
    assertThrows(IllegalArgumentException.class, () -> new ExportRequest(id, 0, "EXPORT_HTML"));
    assertThrows(
        IllegalArgumentException.class,
        () -> new ExportRequest(id, ExportRequest.MAX_REVISION + 1, "EXPORT_HTML"));
    assertThrows(IllegalArgumentException.class, () -> new ExportRequest(id, 1, "PREVIEW"));
  }

  @Test
  void quotaAndLeasePoliciesEnforceLimitsAtTheirBoundaries() {
    JobQuotaPolicy.requireCapacity(4, 5);
    assertEquals(
        "QUOTA_EXCEEDED",
        assertThrows(JobPolicyViolation.class, () -> JobQuotaPolicy.requireCapacity(5, 5)).code());
    Instant now = Instant.now();
    assertTrue(
        JobLifecyclePolicy.ownsLiveLease("RUNNING", "owner", "owner", now.plusSeconds(1), now));
    assertFalse(JobLifecyclePolicy.ownsLiveLease("RUNNING", "old", "new", now.plusSeconds(1), now));
    assertFalse(JobLifecyclePolicy.ownsLiveLease("RUNNING", "owner", "owner", now, now));
    assertFalse(
        JobLifecyclePolicy.ownsLiveLease("SUCCEEDED", "owner", "owner", now.plusSeconds(1), now));
  }

  @Test
  void retriesAndDownloadsRespectCancelDeadlineAndExpiry() {
    Instant now = Instant.now();
    assertTrue(JobLifecyclePolicy.retryAllowed(true, false, 2, now.plusSeconds(1), now));
    assertFalse(JobLifecyclePolicy.retryAllowed(true, false, 3, now.plusSeconds(1), now));
    assertFalse(JobLifecyclePolicy.retryAllowed(true, true, 1, now.plusSeconds(1), now));
    assertFalse(JobLifecyclePolicy.retryAllowed(true, false, 1, now, now));
    JobLifecyclePolicy.requireDownload("SUCCEEDED", true, now.plusSeconds(1), now);
    assertEquals(
        "JOB_NOT_READY",
        assertThrows(
                JobPolicyViolation.class,
                () -> JobLifecyclePolicy.requireDownload("RUNNING", false, null, now))
            .code());
    assertEquals(
        "RESULT_EXPIRED",
        assertThrows(
                JobPolicyViolation.class,
                () -> JobLifecyclePolicy.requireDownload("SUCCEEDED", true, now, now))
            .code());
  }
}
