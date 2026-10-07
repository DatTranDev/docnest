package vn.editor.document.documents.application.port;

public interface EventPublisher {
  void publish(String topic, String key, String payload) throws Exception;
}
