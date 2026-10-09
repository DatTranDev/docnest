package vn.editor.processing.jobs.infrastructure;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import vn.editor.common.codec.NativeCodec;
import vn.editor.processing.bootstrap.KafkaErrorConfig;

class ProcessingTest {
  @Test
  void htmlEscapesEveryDangerousTextCharacterAndPreservesCombinedStyles() throws Exception {
    String text = "<script> & \"' 😀\n";
    byte[] masks = new byte[text.length()];
    Arrays.fill(masks, (byte) 7);
    var d =
        new NativeCodec.Decoded(
            Map.of("exportBom", false, "preferredExportEol", "LF"),
            text,
            masks,
            100,
            "a".repeat(64));
    var out = new ByteArrayOutputStream();
    ExportRenderer.html(d, out, () -> {});
    String html = out.toString(StandardCharsets.UTF_8);
    assertTrue(html.contains("<b><i><u>"));
    assertTrue(html.contains("&lt;script&gt; &amp; &quot;&#39; 😀\n"));
    assertFalse(html.contains("<script>"));
    assertTrue(html.contains("</u></i></b>"));
  }

  @Test
  void htmlPreservesFontColorSizeAndParagraphAlignment() throws Exception {
    var formatting =
        new NativeCodec.Formatting(
            java.util.List.of(new NativeCodec.FormatRun(0, 5, "Georgia", 18, "#aabbcc")),
            java.util.List.of(new NativeCodec.ParagraphFormat(0, "center")));
    var decoded =
        new NativeCodec.Decoded(
            Map.of(), "Hello\nworld", new byte[11], 100, "a".repeat(64), formatting);
    var out = new ByteArrayOutputStream();
    ExportRenderer.html(decoded, out, () -> {});
    String html = out.toString(StandardCharsets.UTF_8);
    assertTrue(html.contains("text-align:center"));
    assertTrue(html.contains("font-family:'Georgia'"));
    assertTrue(html.contains("font-size:18pt"));
    assertTrue(html.contains("color:#aabbcc"));
    assertTrue(html.contains("Hello"));
  }

  @Test
  void htmlAndTxtRenderEmbeddedImage() throws Exception {
    var image =
        new NativeCodec.EmbeddedImage(
            1,
            "c7400587-68dd-4afa-a90e-358783bf2dc0",
            "image/png",
            1,
            1,
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==");
    var document =
        new NativeCodec.Decoded(
            Map.of("exportBom", false, "preferredExportEol", "LF"),
            "A\ufffcB",
            new byte[3],
            100,
            "a".repeat(64),
            NativeCodec.Formatting.empty(),
            java.util.List.of(image));
    var html = new ByteArrayOutputStream();
    ExportRenderer.html(document, html, () -> {});
    assertTrue(
        html.toString(StandardCharsets.UTF_8)
            .contains("<img alt=\"Image\" src=\"data:image/png;base64,"));
    var txt = new ByteArrayOutputStream();
    ExportRenderer.txt(document, txt, () -> {});
    assertEquals("A[Image]B", txt.toString(StandardCharsets.UTF_8));
  }

  @Test
  void txtUsesStoredEolAndBomWithoutFakeFormatting() throws Exception {
    String text = "A\nB😀";
    byte[] masks = new byte[text.length()];
    Arrays.fill(masks, (byte) 7);
    var d =
        new NativeCodec.Decoded(
            Map.of("exportBom", true, "preferredExportEol", "CRLF"),
            text,
            masks,
            100,
            "a".repeat(64));
    var out = new ByteArrayOutputStream();
    ExportRenderer.txt(d, out, () -> {});
    assertEquals("\ufeffA\r\nB😀", out.toString(StandardCharsets.UTF_8));
  }

  @Test
  void actual64MiBOutputCapRejectsRatherThanTruncates() throws Exception {
    var out =
        new ExportRenderer.CappedOutput(OutputStream.nullOutputStream(), ExportRenderer.MAX_OUTPUT);
    byte[] block = new byte[65536];
    for (int i = 0; i < 1024; i++) out.write(block);
    assertEquals(67108864, out.count());
    assertThrows(ExportRenderer.OutputTooLarge.class, () -> out.write(0));
    assertEquals(67108864, out.count());
  }

  @Test
  void previewCountsUnicodeWhiteSpaceAndDoesNotSplitGraphemes() {
    assertEquals(4L, ExportRenderer.preview("a\u00a0b\u0085c\u202fd").get("wordCount"));
    String text = "x".repeat(1999) + "👨‍👩‍👧‍👦";
    String sample = (String) ExportRenderer.preview(text).get("sampleText");
    assertEquals("x".repeat(1999), sample);
    assertEquals(1L, ExportRenderer.preview(text).get("wordCount"));
  }

  @Test
  void schemaRejectsCredentialFieldsAndBadProducer() throws Exception {
    var events = new ProcessingEvents(new ObjectMapper());
    Map<String, Object> event =
        events.envelope(
            "JobRequested",
            Map.of(
                "jobId",
                UUID.randomUUID().toString(),
                "documentId",
                UUID.randomUUID().toString(),
                "revision",
                1));
    assertNotNull(events.parse("processing.job.requested.v1", events.encode(event)));
    event.put("accessToken", "sensitive");
    assertThrows(
        IllegalArgumentException.class,
        () -> events.parse("processing.job.requested.v1", events.encode(event)));
    event.remove("accessToken");
    event.put("producer", "browser");
    assertThrows(
        IllegalArgumentException.class,
        () -> events.parse("processing.job.requested.v1", events.encode(event)));
  }

  @Test
  void recordFormattersNeverExposeKeysOrUnvalidatedPayloads() {
    var config = new KafkaErrorConfig();
    config.safeRecordFormatters();
    String secret = "PRIVATE_SECRET_DO_NOT_LOG";
    var producer =
        new org.apache.kafka.clients.producer.ProducerRecord<String, String>(
            "document.version.saved.v1", "RAW_KEY_DO_NOT_LOG", secret);
    var consumer =
        new org.apache.kafka.clients.consumer.ConsumerRecord<String, String>(
            "document.version.saved.v1", 1, 4, "RAW_KEY_DO_NOT_LOG", secret);
    assertEquals(
        "document.version.saved.v1-null",
        org.springframework.kafka.support.KafkaUtils.format(producer));
    assertEquals(
        "document.version.saved.v1-1@4",
        org.springframework.kafka.support.KafkaUtils.format(consumer));
    assertFalse(config.kafkaErrorHandler().isAckAfterHandle());
  }
}
