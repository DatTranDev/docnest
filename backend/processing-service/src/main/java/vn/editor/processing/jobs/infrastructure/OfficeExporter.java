package vn.editor.processing.jobs.infrastructure;

import com.openhtmltopdf.outputdevice.helper.BaseRendererBuilder.FontStyle;
import com.openhtmltopdf.outputdevice.helper.ExternalResourceControlPriority;
import com.openhtmltopdf.pdfboxout.PdfRendererBuilder;
import com.openhtmltopdf.util.XRLog;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;
import java.util.stream.Collectors;
import org.apache.poi.util.Units;
import org.apache.poi.wp.usermodel.HeaderFooterType;
import org.apache.poi.xwpf.usermodel.Document;
import org.apache.poi.xwpf.usermodel.LineSpacingRule;
import org.apache.poi.xwpf.usermodel.ParagraphAlignment;
import org.apache.poi.xwpf.usermodel.UnderlinePatterns;
import org.apache.poi.xwpf.usermodel.VerticalAlign;
import org.apache.poi.xwpf.usermodel.XWPFAbstractNum;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.XWPFParagraph;
import org.apache.poi.xwpf.usermodel.XWPFRun;
import org.apache.poi.xwpf.usermodel.XWPFTable;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTAbstractNum;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.STNumberFormat;
import vn.editor.common.codec.NativeCodec;

/** Office layout is bounded separately from streaming large-text exports. */
final class OfficeExporter {
  static final int MAX_UNITS = 200000, MAX_PARAGRAPHS = 2000;

  static final class RichExportLimit extends IOException {
    RichExportLimit() {
      super("RICH_EXPORT_LIMIT");
    }
  }

  static {
    XRLog.setLoggingEnabled(false);
  }

  private static void bounded(NativeCodec.Decoded d) throws RichExportLimit {
    if (d.text().length() > MAX_UNITS
        || d.text().chars().filter(c -> c == '\n').count() >= MAX_PARAGRAPHS
        || d.images().stream().mapToLong(image -> (long) image.width() * image.height()).sum()
            > 16777216) throw new RichExportLimit();
  }

  static void pdf(NativeCodec.Decoded d, OutputStream out, Runnable check) throws Exception {
    bounded(d);
    check.run();
    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    StructuredHtml.write(d, new ExportRenderer.CappedOutput(bytes, 16777216), check);
    String html =
        bytes
            .toString(StandardCharsets.UTF_8)
            .replace("font-family:Arial,sans-serif", "font-family:NotoSans,sans-serif");
    for (String font : new String[] {"Arial", "Verdana"})
      html = html.replace("font-family:'" + font + "'", "font-family:NotoSans");
    for (String font : new String[] {"Times New Roman", "Georgia"})
      html = html.replace("font-family:'" + font + "'", "font-family:NotoSerif");
    html = html.replace("font-family:'Courier New'", "font-family:NotoSansMono");
    var builder = new PdfRendererBuilder();
    builder.useFastMode();
    builder.withHtmlContent(html, null);
    builder.toStream(out);
    builder.useExternalResourceAccessControl(
        (uri, type) -> inlineImage(uri), ExternalResourceControlPriority.RUN_BEFORE_RESOLVING_URI);
    builder.useExternalResourceAccessControl(
        (uri, type) -> inlineImage(uri), ExternalResourceControlPriority.RUN_AFTER_RESOLVING_URI);
    builder.useUriResolver((base, uri) -> inlineImage(uri) ? uri : null);
    for (String family : new String[] {"NotoSans", "NotoSerif", "NotoSansMono"})
      for (String face : new String[] {"Regular", "Bold", "Italic", "BoldItalic"}) {
        // Mono has no italic faces in the bundled upstream family; synthesize those.
        if (family.equals("NotoSansMono") && face.contains("Italic")) continue;
        String resource = "/fonts/" + family + "-" + face + ".ttf";
        builder.useFont(
            () -> OfficeExporter.class.getResourceAsStream(resource),
            family,
            face.contains("Bold") ? 700 : 400,
            face.contains("Italic") ? FontStyle.ITALIC : FontStyle.NORMAL,
            true);
      }
    check.run();
    builder.run();
    check.run();
  }

  private static boolean inlineImage(String uri) {
    return uri != null
        && (uri.startsWith("data:image/png;base64,") || uri.startsWith("data:image/jpeg;base64,"));
  }

  static void docx(NativeCodec.Decoded d, OutputStream out, Runnable check) throws Exception {
    bounded(d);
    check.run();
    try (var doc = new XWPFDocument()) {
      var section = doc.getDocument().getBody().addNewSectPr();
      var size = section.addNewPgSz();
      size.setW(BigInteger.valueOf(11906));
      size.setH(BigInteger.valueOf(16838));
      var margins = section.addNewPgMar();
      margins.setTop(BigInteger.valueOf(1247));
      margins.setBottom(BigInteger.valueOf(1247));
      margins.setLeft(BigInteger.valueOf(1020));
      margins.setRight(BigInteger.valueOf(1020));
      var page = d.formatting().page();
      doc.createHeader(HeaderFooterType.DEFAULT)
          .createParagraph()
          .createRun()
          .setText(page.header());
      var footer = doc.createFooter(HeaderFooterType.DEFAULT).createParagraph();
      footer.createRun().setText(page.footer());
      if (page.pageNumbers()) {
        footer.createRun().setText(" ");
        footer.getCTP().addNewFldSimple().setInstr("PAGE");
      }
      var numbering = doc.createNumbering();
      Map<Integer, NativeCodec.ParagraphFormat> paragraphs =
          d.formatting().paragraphs().stream()
              .collect(Collectors.toMap(NativeCodec.ParagraphFormat::from, p -> p));
      NativeCodec.TableCell table = null;
      XWPFTable active = null;
      int cell = 0;
      String lastList = null;
      BigInteger numId = null;
      int lastIndent = -1;
      for (int from = 0; from <= d.text().length(); ) {
        check.run();
        int to = d.text().indexOf('\n', from);
        if (to < 0) to = d.text().length();
        var p = paragraphs.getOrDefault(from, new NativeCodec.ParagraphFormat(from, "left"));
        XWPFParagraph paragraph;
        if (p.table() != null) {
          if (table == null || !table.equals(p.table()) || p.pageBreak()) {
            table = p.table();
            if (p.pageBreak()) doc.createParagraph().setPageBreak(true);
            active = doc.createTable(1, table.columns());
            active.setWidth("100%");
            cell = 0;
          }
          if (cell > 0 && cell % table.columns() == 0) active.createRow();
          var row = active.getRow(cell / table.columns());
          while (row.getTableCells().size() < table.columns()) row.addNewTableCell();
          paragraph = row.getCell(cell % table.columns()).getParagraphs().getFirst();
          cell++;
        } else {
          table = null;
          active = null;
          paragraph = doc.createParagraph();
        }
        paragraph.setAlignment(
            ParagraphAlignment.valueOf(p.align().toUpperCase(java.util.Locale.ROOT)));
        paragraph.setIndentationLeft(p.indent() * 360);
        paragraph.setSpacingBetween(p.lineSpacing(), LineSpacingRule.AUTO);
        paragraph.setSpacingBefore(p.spaceBefore() * 20);
        paragraph.setSpacingAfter(p.spaceAfter() * 20);
        paragraph.setPageBreak(p.pageBreak() && p.table() == null);
        if (p.list() != null) {
          if (!p.list().equals(lastList) || p.indent() != lastIndent) {
            CTAbstractNum definition = CTAbstractNum.Factory.newInstance();
            definition.setAbstractNumId(BigInteger.valueOf(numbering.getAbstractNums().size() + 1));
            var level = definition.addNewLvl();
            level.setIlvl(BigInteger.ZERO);
            level.addNewStart().setVal(BigInteger.ONE);
            level
                .addNewNumFmt()
                .setVal(p.list().equals("number") ? STNumberFormat.DECIMAL : STNumberFormat.BULLET);
            level.addNewLvlText().setVal(p.list().equals("number") ? "%1." : "•");
            numId = numbering.addNum(numbering.addAbstractNum(new XWPFAbstractNum(definition)));
          }
          paragraph.setNumID(numId);
        }
        runs(d, paragraph, from, to, check);
        lastList = p.list();
        lastIndent = p.indent();
        if (to == d.text().length()) break;
        from = to + 1;
      }
      check.run();
      doc.write(out);
      check.run();
    }
  }

  private static void runs(
      NativeCodec.Decoded d, XWPFParagraph paragraph, int from, int to, Runnable check)
      throws Exception {
    int runIndex = 0, imageIndex = 0; // Bounded office documents; advance once per paragraph.
    while (runIndex < d.formatting().runs().size()
        && d.formatting().runs().get(runIndex).to() <= from) runIndex++;
    while (imageIndex < d.images().size() && d.images().get(imageIndex).from() < from) imageIndex++;
    for (int at = from; at < to; ) {
      check.run();
      while (runIndex < d.formatting().runs().size()
          && d.formatting().runs().get(runIndex).to() <= at) runIndex++;
      var format =
          runIndex < d.formatting().runs().size()
                  && d.formatting().runs().get(runIndex).from() <= at
              ? d.formatting().runs().get(runIndex)
              : null;
      XWPFRun run =
          format != null && format.link() != null
              ? paragraph.createHyperlinkRun(format.link())
              : paragraph.createRun();
      int mask = d.masks()[at];
      run.setBold((mask & 1) != 0);
      run.setItalic((mask & 2) != 0);
      if ((mask & 4) != 0) run.setUnderline(UnderlinePatterns.SINGLE);
      run.setFontFamily(format == null || format.font() == null ? "Arial" : format.font());
      run.setFontSize(format == null || format.size() == null ? 11 : format.size());
      if (format != null) {
        if (format.color() != null) run.setColor(format.color().substring(1));
        run.setStrikeThrough(format.strike());
        if (format.background() != null)
          run.getCTR().addNewRPr().addNewShd().setFill(format.background().substring(1));
        if (format.script() != null)
          run.setSubscript(
              format.script().equals("super")
                  ? VerticalAlign.SUPERSCRIPT
                  : VerticalAlign.SUBSCRIPT);
      }
      if (imageIndex < d.images().size() && d.images().get(imageIndex).from() == at) {
        var im = d.images().get(imageIndex++);
        try (var input = new ByteArrayInputStream(Base64.getDecoder().decode(im.data()))) {
          run.addPicture(
              input,
              im.mime().equals("image/png")
                  ? Document.PICTURE_TYPE_PNG
                  : Document.PICTURE_TYPE_JPEG,
              "image",
              Units.pixelToEMU(Math.min(im.width(), 650)),
              Units.pixelToEMU((int) (im.height() * Math.min(1.0, 650.0 / im.width()))));
        }
        at++;
        continue;
      }
      int end =
          format == null
              ? (runIndex < d.formatting().runs().size()
                  ? Math.min(to, d.formatting().runs().get(runIndex).from())
                  : to)
              : Math.min(to, format.to());
      if (imageIndex < d.images().size()) end = Math.min(end, d.images().get(imageIndex).from());
      int same = at + 1;
      while (same < end && d.masks()[same] == mask) same++;
      end = same;
      run.setText(d.text().substring(at, end));
      at = end;
    }
  }

  private OfficeExporter() {}
}
