package vn.editor.payment.billing.domain;

import java.time.Instant;
import java.util.Set;

public final class BillingPolicy {
  public static final Set<String> PLANS = Set.of("FREE", "PRO_MONTHLY", "PRO_YEARLY");

  public static void requestKind(String kind) {
    if (!Set.of("CHECKOUT", "PORTAL", "CANCEL", "SYNC").contains(kind))
      throw new BillingFailure("INVALID_BILLING_REQUEST");
  }

  public record RequestEligibility(
      String plan,
      Instant expiresAt,
      boolean customerKnown,
      boolean subscriptionKnown,
      boolean reviewNeeded) {
    public void require(String kind, int unexpiredCheckouts, int queued, Instant now) {
      requestKind(kind);
      if (reviewNeeded && (!customerKnown || kind.equals("CHECKOUT")))
        throw new BillingFailure("BILLING_REVIEW_REQUIRED");
      if (kind.equals("CHECKOUT")) {
        if (!effective(plan, expiresAt, now).equals("FREE") || subscriptionKnown)
          throw new BillingFailure("SUBSCRIPTION_EXISTS");
        if (unexpiredCheckouts > 0) throw new BillingFailure("CHECKOUT_IN_PROGRESS");
      }
      if (kind.equals("CANCEL") && !subscriptionKnown) throw new BillingFailure("NO_SUBSCRIPTION");
      if (queued >= 5) throw new BillingFailure("BILLING_QUEUE_LIMIT");
    }
  }

  public static void checkout(String plan) {
    if (plan == null || !PLANS.contains(plan) || plan.equals("FREE"))
      throw new BillingFailure("INVALID_PLAN");
  }

  public static String effective(String plan, Instant expires, Instant now) {
    return expires != null && expires.isAfter(now) ? plan : "FREE";
  }

  public static int participant(String name) {
    return switch (name) {
      case "identity" -> 1;
      case "document" -> 2;
      case "processing" -> 4;
      case "collaboration" -> 8;
      default -> throw new BillingFailure("INVALID_PARTICIPANT");
    };
  }

  public static boolean complete(int replies) {
    return replies == 15;
  }

  private BillingPolicy() {}
}
