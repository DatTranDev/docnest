package vn.editor.document.documents.domain;

import java.util.Map;

public record ValidatedSnapshot(
    String nativeSha256, long nativeBytes, Map<String, Object> manifest) {
  public ValidatedSnapshot {
    manifest = Map.copyOf(manifest);
  }
}
