package vn.editor.payment.billing.domain;

public final class BillingFailure extends RuntimeException {
  public BillingFailure(String code) {
    super(code);
  }
}
