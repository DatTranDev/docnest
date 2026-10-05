package vn.editor.document.documents.application.port;

public interface OutboxRepository {
  record Message(long id, String topic, String key, String payload, int previousAttempts) {}

  Message claim(String leaseOwner);

  void published(long id, String leaseOwner);

  void retry(long id, String leaseOwner, int attempts, String error);
}
