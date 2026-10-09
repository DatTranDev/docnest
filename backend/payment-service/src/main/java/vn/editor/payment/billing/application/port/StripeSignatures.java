package vn.editor.payment.billing.application.port;

public interface StripeSignatures {
  boolean configured();

  record Notification(String eventId, String fingerprint, String type, String customer) {}

  Notification verify(byte[] bytes, String header);
}
