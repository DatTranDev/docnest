package vn.editor.collaboration.subscriptions.domain;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

public record PlanGrant(
    UUID userId, UUID sagaId, long generation, String phase, String plan, Instant expiresAt) {
  public PlanGrant {
    if (userId == null
        || sagaId == null
        || generation < 1
        || phase == null
        || !Set.of("APPLY", "COMPENSATE").contains(phase)
        || plan == null
        || !Set.of("FREE", "PRO_MONTHLY", "PRO_YEARLY").contains(plan))
      throw new IllegalArgumentException("INVALID_ENTITLEMENT");
    if (!plan.equals("FREE") && expiresAt == null)
      throw new IllegalArgumentException("MISSING_ENTITLEMENT_EXPIRY");
  }

  public boolean supersedes(long previous) {
    return generation > previous;
  }

  public String effective(Instant now) {
    return expiresAt != null && !expiresAt.isAfter(now) ? "FREE" : plan;
  }

  public boolean canApply(boolean active) {
    return active || plan.equals("FREE") || phase.equals("COMPENSATE");
  }
}
