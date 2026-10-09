package vn.editor.processing.jobs.infrastructure;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.junit.jupiter.api.Test;
import vn.editor.common.codec.NativeCodec;

class OfficeExporterTest {
  @Test
  void embeddedPngSurvivesBothOfficeFormats() throws Exception {
    String data =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
    var d =
        new NativeCodec.Decoded(
            Map.of("schemaVersion", 5),
            "\ufffc Image Việt",
            new byte[12],
            0,
            "",
            NativeCodec.Formatting.empty(),
            List.of(new NativeCodec.EmbeddedImage(0, "image", "image/png", 1, 1, data)));
    var docx = new ByteArrayOutputStream();
    OfficeExporter.docx(d, docx, () -> {});
    try (var doc = new XWPFDocument(new ByteArrayInputStream(docx.toByteArray()))) {
      assertEquals(1, doc.getAllPictures().size());
      assertEquals(
          data,
          java.util.Base64.getEncoder().encodeToString(doc.getAllPictures().getFirst().getData()));
    }
    var output = new ByteArrayOutputStream();
    OfficeExporter.pdf(d, output, () -> {});
    try (var pdf = Loader.loadPDF(output.toByteArray())) {
      boolean image = false;
      for (var key : pdf.getPage(0).getResources().getXObjectNames())
        if (pdf.getPage(0).getResources().isImageXObject(key)) image = true;
      assertTrue(image);
    }
  }

  @Test
  void pageBreakInTableStartsANewPreservedGridFragment() throws Exception {
    var original = sample();
    var paragraphs = new java.util.ArrayList<>(original.formatting().paragraphs());
    var p = paragraphs.get(4);
    paragraphs.set(
        4,
        new NativeCodec.ParagraphFormat(
            p.from(),
            p.align(),
            p.list(),
            p.indent(),
            p.lineSpacing(),
            p.spaceBefore(),
            p.spaceAfter(),
            true,
            p.table()));
    var d =
        new NativeCodec.Decoded(
            original.manifest(),
            original.text(),
            original.masks(),
            0,
            "",
            new NativeCodec.Formatting(
                original.formatting().runs(), paragraphs, original.formatting().page()),
            original.images());
    var docx = new ByteArrayOutputStream();
    OfficeExporter.docx(d, docx, () -> {});
    try (var doc = new XWPFDocument(new ByteArrayInputStream(docx.toByteArray()))) {
      assertEquals(2, doc.getTables().size());
      assertEquals("A", doc.getTables().get(0).getRow(0).getCell(0).getText());
      assertEquals("C", doc.getTables().get(1).getRow(0).getCell(0).getText());
    }
    var output = new ByteArrayOutputStream();
    OfficeExporter.pdf(d, output, () -> {});
    try (var pdf = Loader.loadPDF(output.toByteArray())) {
      assertEquals(3, pdf.getNumberOfPages());
    }
  }

  @Test
  void bundledFontInventoryIsReproducible() throws Exception {
    try (var inventory = OfficeExporter.class.getResourceAsStream("/fonts/SHA256SUMS")) {
      String[] rows =
          new String(inventory.readAllBytes(), StandardCharsets.UTF_8).strip().split("\n");
      assertEquals(10, rows.length);
      for (String row : rows) {
        String[] fields = row.split("  ");
        try (var font = OfficeExporter.class.getResourceAsStream("/fonts/" + fields[1])) {
          assertEquals(
              fields[0],
              java.util.HexFormat.of()
                  .formatHex(
                      java.security.MessageDigest.getInstance("SHA-256")
                          .digest(font.readAllBytes())));
        }
      }
    }
  }

  @Test
  void pdfHyperlinksNeverFetchTheirTarget() throws Exception {
    var requests = new java.util.concurrent.atomic.AtomicInteger();
    var server =
        com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/",
        exchange -> {
          requests.incrementAndGet();
          exchange.sendResponseHeaders(200, -1);
          exchange.close();
        });
    server.start();
    try {
      String uri = "http://127.0.0.1:" + server.getAddress().getPort() + "/private";
      var d =
          new NativeCodec.Decoded(
              Map.of("schemaVersion", 5),
              "Link",
              new byte[4],
              0,
              "",
              new NativeCodec.Formatting(
                  List.of(
                      new NativeCodec.FormatRun(0, 4, null, null, null, null, false, null, uri)),
                  List.of()),
              List.of());
      var output = new ByteArrayOutputStream();
      OfficeExporter.pdf(d, output, () -> {});
      assertEquals(0, requests.get());
      try (var pdf = Loader.loadPDF(output.toByteArray())) {
        assertTrue(pdf.getPage(0).getAnnotations().size() > 0);
      }
    } finally {
      server.stop(0);
    }
  }

  private NativeCodec.Decoded sample() {
    String text = "Việt Nam\nOne\nTwo\nA\nB\nC\nD\nNext page";
    var table = new NativeCodec.TableCell("table", 2);
    return new NativeCodec.Decoded(
        Map.of("schemaVersion", 5),
        text,
        new byte[text.length()],
        0,
        "",
        new NativeCodec.Formatting(
            List.of(
                new NativeCodec.FormatRun(
                    0,
                    8,
                    "Georgia",
                    16,
                    "#123456",
                    "#ffff00",
                    true,
                    "super",
                    "https://example.com/?q=a&b=c")),
            List.of(
                new NativeCodec.ParagraphFormat(9, "left", "number", 1, 2, 0, 12, false, null),
                new NativeCodec.ParagraphFormat(13, "left", "number", 1, 2, 0, 12, false, null),
                new NativeCodec.ParagraphFormat(17, "left", null, 0, 1.15, 0, 0, false, table),
                new NativeCodec.ParagraphFormat(19, "left", null, 0, 1.15, 0, 0, false, table),
                new NativeCodec.ParagraphFormat(21, "left", null, 0, 1.15, 0, 0, false, table),
                new NativeCodec.ParagraphFormat(23, "left", null, 0, 1.15, 0, 0, false, table),
                new NativeCodec.ParagraphFormat(25, "center", null, 0, 1.5, 0, 0, true, null)),
            new NativeCodec.PageSettings("Header Việt", "Footer Việt", true)),
        List.of());
  }

  @Test
  void actualDocxContainsTablesLinksNumberingStylesHeaderFooterAndBreaks() throws Exception {
    var out = new ByteArrayOutputStream();
    OfficeExporter.docx(sample(), out, () -> {});
    try (var doc = new XWPFDocument(new ByteArrayInputStream(out.toByteArray()))) {
      assertEquals(1, doc.getTables().size());
      assertEquals(2, doc.getTables().getFirst().getRows().size());
      assertEquals("D", doc.getTables().getFirst().getRow(1).getCell(1).getText());
      assertTrue(doc.getParagraphs().get(1).getNumID() != null);
      assertEquals(doc.getParagraphs().get(1).getNumID(), doc.getParagraphs().get(2).getNumID());
      assertTrue(doc.getDocument().xmlText().contains("w:pageBreakBefore"));
      assertTrue(doc.getDocument().xmlText().contains("w:hyperlink"));
      assertTrue(
          doc.getDocument().xmlText().contains("FFFF00")
              || doc.getDocument().xmlText().contains("ffff00"));
      assertTrue(doc.getHeaderList().getFirst().getText().contains("Header Việt"));
      assertTrue(doc.getFooterList().getFirst().getText().contains("Footer Việt"));
      assertTrue(doc.getFooterList().getFirst()._getHdrFtr().xmlText().contains("PAGE"));
    }
  }

  @Test
  void actualPdfContainsUnicodeRepeatingHeadersFooterLinksTableAndStoredPageBreak()
      throws Exception {
    var out = new ByteArrayOutputStream();
    OfficeExporter.pdf(sample(), out, () -> {});
    assertTrue(out.toString(StandardCharsets.ISO_8859_1).startsWith("%PDF-"));
    try (var pdf = Loader.loadPDF(out.toByteArray())) {
      assertEquals(2, pdf.getNumberOfPages());
      String text = new PDFTextStripper().getText(pdf);
      assertTrue(text.contains("Việt Nam"));
      assertTrue(text.contains("Next page"));
      assertEquals(2, text.split("Header Việt", -1).length - 1);
      assertEquals(2, text.split("Footer Việt", -1).length - 1);
      assertTrue(pdf.getPage(0).getAnnotations().size() > 0);
      var renderer = new org.apache.pdfbox.rendering.PDFRenderer(pdf);
      Path imageEvidence = Path.of("../../testing/reports/raw/structure-pdf-0.png");
      Files.createDirectories(imageEvidence.getParent());
      for (int page = 0; page < pdf.getNumberOfPages(); page++) {
        javax.imageio.ImageIO.write(
            renderer.renderImageWithDPI(page, 96),
            "png",
            Path.of("../../testing/reports/raw/structure-pdf-" + page + ".png").toFile());
      }
    }
    Path evidence = Path.of("../../testing/reports/raw/structure-export.pdf");
    Files.createDirectories(evidence.getParent());
    Files.write(evidence, out.toByteArray());
  }

  @Test
  void xhtmlEscapesPrivateTextAndUriAndRepresentsRealTablesAndListNumbers() throws Exception {
    var out = new ByteArrayOutputStream();
    StructuredHtml.write(sample(), out, () -> {});
    String html = out.toString(StandardCharsets.UTF_8);
    assertTrue(html.contains("<table"));
    assertTrue(html.contains("<ol start=\"2\""));
    assertTrue(html.contains("q=a&amp;b=c"));
    assertTrue(html.contains("page-break-before:always"));
  }

  @Test
  void boundedRichExportDoesNotReplaceLargeStreamingTxtAndHtml() {
    String text = "x".repeat(200001);
    var d = new NativeCodec.Decoded(Map.of(), text, new byte[text.length()], 0, "");
    assertThrows(
        OfficeExporter.RichExportLimit.class,
        () -> OfficeExporter.pdf(d, new ByteArrayOutputStream(), () -> {}));
    assertThrows(
        OfficeExporter.RichExportLimit.class,
        () -> OfficeExporter.docx(d, new ByteArrayOutputStream(), () -> {}));
  }
}
