package vn.editor.document.shared.api;

import java.io.InputStream;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

public final class Streams {
  private Streams() {}

  public static ResponseEntity<StreamingResponseBody> nativeDocument(
      InputStream input, Runnable release) {
    StreamingResponseBody body =
        output -> {
          try (input) {
            input.transferTo(output);
          } finally {
            if (release != null) release.run();
          }
        };
    return ResponseEntity.ok()
        .contentType(MediaType.APPLICATION_OCTET_STREAM)
        .header("Content-Disposition", "attachment; filename=\"document.tedoc\"")
        .header("Cache-Control", "no-store")
        .header("Referrer-Policy", "no-referrer")
        .body(body);
  }
}
