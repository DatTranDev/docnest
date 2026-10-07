package vn.editor.processing.jobs.application.port;

public interface DocumentAccessPort {
  void authorize(String token, String documentId);

  SourceSnapshot snapshot(String token, String documentId, long revision);
}
