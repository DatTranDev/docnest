package vn.editor.payment.billing.domain;

/** Per-account serialization and increasing compensation generations provide saga isolation. */
public record BillingSaga(long generation, String phase, String state, int replies) {
  public enum Decision {
    IGNORE,
    WAIT,
    ACTIVATE,
    COMPENSATE,
    REVIEW
  }

  public record Result(Decision decision, int replies) {}

  public Result acknowledge(
      long receivedGeneration, String receivedPhase, String participant, String outcome) {
    if (receivedGeneration != generation
        || !phase.equals(receivedPhase)
        || !(state.equals("PROVISIONING") || state.equals("COMPENSATING")))
      return new Result(Decision.IGNORE, replies);
    int bit = BillingPolicy.participant(participant);
    if ((replies & bit) != 0) return new Result(Decision.IGNORE, replies);
    if (!outcome.equals("APPLIED"))
      return new Result(phase.equals("APPLY") ? Decision.COMPENSATE : Decision.IGNORE, replies);
    int next = replies | bit;
    return new Result(
        BillingPolicy.complete(next)
            ? (phase.equals("APPLY") ? Decision.ACTIVATE : Decision.REVIEW)
            : Decision.WAIT,
        next);
  }
}
