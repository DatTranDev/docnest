package vn.editor.document.documents.domain;

public final class DeliveryRetryPolicy {
  private DeliveryRetryPolicy() {}

  public static long seconds(int attempts) {
    return attempts == 1 ? 1 : attempts == 2 ? 5 : attempts == 3 ? 30 : 60;
  }
}
