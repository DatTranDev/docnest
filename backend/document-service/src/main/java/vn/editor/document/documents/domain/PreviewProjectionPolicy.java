package vn.editor.document.documents.domain;

import java.util.Map;

public final class PreviewProjectionPolicy {
  private PreviewProjectionPolicy() {}

  public static boolean eligible(String type, String state, Map<String, Object> summary) {
    return "PREVIEW".equals(type) && "SUCCEEDED".equals(state) && summary != null;
  }
}
