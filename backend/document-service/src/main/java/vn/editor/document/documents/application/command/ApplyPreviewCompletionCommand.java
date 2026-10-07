package vn.editor.document.documents.application.command;

import java.util.Map;

public record ApplyPreviewCompletionCommand(
    String eventId,
    String documentId,
    long revision,
    String type,
    String state,
    Map<String, Object> summary) {
  public static ApplyPreviewCompletionCommand from(Map<String, Object> envelope) {
    Map<String, Object> payload = (Map<String, Object>) envelope.get("payload");
    return new ApplyPreviewCompletionCommand(
        envelope.get("eventId").toString(),
        payload.get("documentId").toString(),
        ((Number) payload.get("revision")).longValue(),
        (String) payload.get("type"),
        (String) payload.get("state"),
        (Map<String, Object>) payload.get("summary"));
  }
}
