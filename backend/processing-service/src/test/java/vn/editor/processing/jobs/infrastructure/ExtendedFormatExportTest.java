package vn.editor.processing.jobs.infrastructure;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import vn.editor.common.codec.NativeCodec;

class ExtendedFormatExportTest {
  @Test
  void emitsAllowlistedExtendedStylesAndEscapesDocumentText() throws Exception {
    var run = new NativeCodec.FormatRun(0, 3, "Arial", 16, "#123456", "#ffff00", true, "super");
    var decoded =
        new NativeCodec.Decoded(
            Map.of(),
            "<&x",
            new byte[] {4, 4, 4},
            0,
            "",
            new NativeCodec.Formatting(List.of(run), List.of()),
            List.of());
    var output = new ByteArrayOutputStream();
    ExportRenderer.html(decoded, output, () -> {});
    String html = output.toString(StandardCharsets.UTF_8);
    assertTrue(html.contains("background-color:#ffff00;"));
    assertTrue(html.contains("text-decoration-line:line-through;"));
    assertTrue(html.contains("vertical-align:super;font-size:12.0pt;"));
    assertTrue(html.contains("<u>&lt;&amp;x</u>"));
  }
}
