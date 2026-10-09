package vn.editor.processing.jobs.infrastructure;

import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.stream.Collectors;
import vn.editor.common.codec.NativeCodec;

/** Generated XHTML only: no user HTML, external images, fonts, CSS or scripts. */
final class StructuredHtml {
  static void write(NativeCodec.Decoded d, OutputStream out, Runnable check) throws IOException {
    try (Writer w = new OutputStreamWriter(out, StandardCharsets.UTF_8)) {
      w.write(
          "<html xmlns=\"http://www.w3.org/1999/xhtml\"><head><meta charset=\"utf-8\"/><title>Export</title><style>");
      w.write(
          "@page{size:A4;margin:22mm 18mm;@top-center{content:element(header)}@bottom-center{content:element(footer)}}body{font-family:Arial,sans-serif;font-size:11pt;}#header{position:running(header)}#footer{position:running(footer)}.page-number:before{content:counter(page)}.paragraph{white-space:pre-wrap;min-height:1em}table{border-collapse:collapse;width:100%;table-layout:fixed}td{border:1px solid #cbd5e1;padding:6pt;vertical-align:top}tr{page-break-inside:avoid}img{max-width:100%;height:auto}ol,ul{margin-top:0;margin-bottom:0}a{color:#1967d2;text-decoration:underline}</style></head><body>");
      var page = d.formatting().page();
      w.write("<div id=\"header\">");
      escape(w, page.header());
      w.write("</div><div id=\"footer\">");
      escape(w, page.footer());
      if (page.pageNumbers()) w.write(" <span class=\"page-number\"></span>");
      w.write("</div>");
      Map<Integer, NativeCodec.ParagraphFormat> paragraphs =
          d.formatting().paragraphs().stream()
              .collect(Collectors.toMap(NativeCodec.ParagraphFormat::from, p -> p));
      NativeCodec.TableCell table = null;
      int cell = 0, ordinal = 0, lastIndent = -1;
      String previousList = null;
      for (int from = 0; from <= d.text().length(); ) {
        check.run();
        int to = d.text().indexOf('\n', from);
        if (to < 0) to = d.text().length();
        var p = paragraphs.getOrDefault(from, new NativeCodec.ParagraphFormat(from, "left"));
        if (table != null && (p.table() == null || !table.equals(p.table()) || p.pageBreak())) {
          finishTable(w, cell, table.columns());
          table = null;
          cell = 0;
        }
        if (p.table() != null) {
          if (table == null) {
            table = p.table();
            w.write("<table style=\"");
            if (p.pageBreak()) w.write("page-break-before:always;");
            w.write("\"><tbody>");
          }
          if (cell % table.columns() == 0) w.write("<tr>");
          w.write("<td>");
        }
        if ("number".equals(p.list()))
          ordinal = "number".equals(previousList) && lastIndent == p.indent() ? ordinal + 1 : 1;
        else ordinal = 0;
        if (p.list() != null) {
          w.write(p.list().equals("number") ? "<ol start=\"" + ordinal + "\"><li>" : "<ul><li>");
        }
        w.write("<div class=\"paragraph\" style=\"");
        paragraphCss(w, p);
        w.write("\">");
        inline(w, d, from, to, check);
        if (from == to) w.write("&#160;");
        w.write("</div>");
        if (p.list() != null) w.write(p.list().equals("number") ? "</li></ol>" : "</li></ul>");
        if (table != null) {
          w.write("</td>");
          cell++;
          if (cell % table.columns() == 0) w.write("</tr>");
        }
        previousList = p.list();
        lastIndent = p.indent();
        if (to == d.text().length()) break;
        from = to + 1;
      }
      if (table != null) finishTable(w, cell, table.columns());
      w.write("</body></html>");
    }
  }

  private static void finishTable(Writer w, int cells, int columns) throws IOException {
    if (cells % columns != 0) {
      for (int n = cells % columns; n < columns; n++) w.write("<td></td>");
      w.write("</tr>");
    }
    w.write("</tbody></table>");
  }

  private static void paragraphCss(Writer w, NativeCodec.ParagraphFormat p) throws IOException {
    w.write(
        "text-align:"
            + p.align()
            + ";margin-left:"
            + (p.indent() * 18)
            + "pt;line-height:"
            + p.lineSpacing()
            + ";margin-top:"
            + p.spaceBefore()
            + "pt;margin-bottom:"
            + p.spaceAfter()
            + "pt;");
    if (p.pageBreak() && p.table() == null) w.write("page-break-before:always;");
  }

  private static void inline(Writer w, NativeCodec.Decoded d, int from, int to, Runnable check)
      throws IOException {
    int run = lowerRun(d, from), image = lowerImage(d, from);
    for (int at = from; at < to; ) {
      check.run();
      while (run < d.formatting().runs().size() && d.formatting().runs().get(run).to() <= at) run++;
      var r =
          run < d.formatting().runs().size() && d.formatting().runs().get(run).from() <= at
              ? d.formatting().runs().get(run)
              : null;
      if (image < d.images().size() && d.images().get(image).from() == at) {
        var im = d.images().get(image++);
        w.write(
            "<img alt=\"Image\" src=\"data:"
                + im.mime()
                + ";base64,"
                + im.data()
                + "\" width=\""
                + im.width()
                + "\" height=\""
                + im.height()
                + "\"/>");
        at++;
        continue;
      }
      int end =
          r == null
              ? (run < d.formatting().runs().size()
                  ? Math.min(to, d.formatting().runs().get(run).from())
                  : to)
              : Math.min(to, r.to());
      if (image < d.images().size()) end = Math.min(end, d.images().get(image).from());
      int mask = d.masks()[at];
      int same = at + 1;
      while (same < end && d.masks()[same] == mask) same++;
      end = same;
      if (r != null && r.link() != null) {
        w.write("<a href=\"");
        escape(w, r.link());
        w.write("\">");
      }
      w.write("<span style=\"");
      if ((mask & 1) != 0) w.write("font-weight:bold;");
      if ((mask & 2) != 0) w.write("font-style:italic;");
      if ((mask & 4) != 0 || (r != null && r.strike()))
        w.write(
            "text-decoration:"
                + ((mask & 4) != 0 ? "underline " : "")
                + (r != null && r.strike() ? "line-through" : "")
                + ";");
      if (r != null) {
        if (r.font() != null) w.write("font-family:'" + r.font() + "';");
        if (r.size() != null) w.write("font-size:" + r.size() + "pt;");
        if (r.color() != null) w.write("color:" + r.color() + ";");
        if (r.background() != null) w.write("background-color:" + r.background() + ";");
        if (r.script() != null)
          w.write(
              "vertical-align:"
                  + r.script()
                  + ";font-size:"
                  + (r.size() == null ? "0.75em" : r.size() * 0.75 + "pt")
                  + ";");
      }
      w.write("\">");
      escape(w, d.text().substring(at, end));
      w.write("</span>");
      if (r != null && r.link() != null) w.write("</a>");
      at = end;
    }
  }

  private static int lowerRun(NativeCodec.Decoded d, int from) {
    int lo = 0, hi = d.formatting().runs().size();
    while (lo < hi) {
      int mid = (lo + hi) >>> 1;
      if (d.formatting().runs().get(mid).to() <= from) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private static int lowerImage(NativeCodec.Decoded d, int from) {
    int lo = 0, hi = d.images().size();
    while (lo < hi) {
      int mid = (lo + hi) >>> 1;
      if (d.images().get(mid).from() < from) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  static void escape(Writer w, String text) throws IOException {
    for (int i = 0; i < text.length(); i++)
      switch (text.charAt(i)) {
        case '&' -> w.write("&amp;");
        case '<' -> w.write("&lt;");
        case '>' -> w.write("&gt;");
        case '"' -> w.write("&quot;");
        case '\'' -> w.write("&#39;");
        default -> {
          char c = text.charAt(i);
          w.write(c < 32 && c != '\t' && c != '\n' ? '\ufffd' : c);
        }
      }
  }

  private StructuredHtml() {}
}
