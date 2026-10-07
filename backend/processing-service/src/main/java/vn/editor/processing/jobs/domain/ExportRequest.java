package vn.editor.processing.jobs.domain;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Set;
import java.util.UUID;

public record ExportRequest(String documentId, long revision, String type) {
  public static final long MAX_REVISION = 9_007_199_254_740_991L;

  public ExportRequest {
    documentId = UUID.fromString(documentId).toString();
    if (revision < 1
        || revision > MAX_REVISION
        || !Set.of("EXPORT_TXT", "EXPORT_HTML").contains(type)) {
      throw new IllegalArgumentException("Invalid export request");
    }
  }

  public String bodyHash() {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256")
                  .digest(
                      (documentId + "\n" + revision + "\n" + type)
                          .getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException impossible) {
      throw new IllegalStateException(impossible);
    }
  }
}
