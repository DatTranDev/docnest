package vn.editor.processing.jobs.infrastructure;

import com.ibm.icu.text.BreakIterator;
import com.ibm.icu.util.ULocale;
import java.io.BufferedWriter;
import java.io.FilterOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import vn.editor.common.codec.NativeCodec;

/** Emits bounded output incrementally; source model is bounded by the native decoder. */
public final class ExportRenderer {
  static final long MAX_OUTPUT = 67108864;

  public static class OutputTooLarge extends IOException {
    OutputTooLarge() {
      super("EXPORT_TOO_LARGE");
    }
  }

  public static final class CappedOutput extends FilterOutputStream {
    private final long cap;
    private long count;

    public CappedOutput(OutputStream out, long cap) {
      super(out);
      this.cap = cap;
    }

    @Override
    public void write(int b) throws IOException {
      if (count + 1 > cap) throw new OutputTooLarge();
      out.write(b);
      count++;
    }

    @Override
    public void write(byte[] b, int off, int len) throws IOException {
      if (count + len > cap) throw new OutputTooLarge();
      out.write(b, off, len);
      count += len;
    }

    public long count() {
      return count;
    }
  }

  static void txt(NativeCodec.Decoded d, OutputStream output, Runnable check) throws IOException {
    try (Writer w = new OutputStreamWriter(output, StandardCharsets.UTF_8)) {
      if (Boolean.TRUE.equals(d.manifest().get("exportBom"))) w.write('\ufeff');
      boolean crlf = "CRLF".equals(d.manifest().get("preferredExportEol"));
      String text = d.text();
      int imageIndex = 0;
      for (int from = 0; from < text.length(); ) {
        check.run();
        int to = Math.min(from + 32768, text.length());
        if (to < text.length() && Character.isHighSurrogate(text.charAt(to - 1))) to--;
        for (int i = from; i < to; i++) {
          if (imageIndex < d.images().size() && d.images().get(imageIndex).from() == i) {
            w.write("[Image]");
            imageIndex++;
            continue;
          }
          char c = text.charAt(i);
          if (crlf && c == '\n') w.write('\r');
          w.write(c);
        }
        from = to;
      }
    }
  }

  static void html(NativeCodec.Decoded d, OutputStream output, Runnable check) throws IOException {
    if (Integer.valueOf(5).equals(d.manifest().get("schemaVersion"))) {
      StructuredHtml.write(d, output, check);
      return;
    }
    if (!d.formatting().runs().isEmpty()
        || !d.formatting().paragraphs().isEmpty()
        || !d.images().isEmpty()) {
      richHtml(d, output, check);
      return;
    }
    try (Writer w =
        new BufferedWriter(new OutputStreamWriter(output, StandardCharsets.UTF_8), 32768)) {
      w.write(
          "<!doctype html><html><head><meta charset=\"utf-8\"><title>Export</title></head><body><pre>");
      String text = d.text();
      byte[] masks = d.masks();
      int current = 0;
      for (int i = 0; i < text.length(); i++) {
        if ((i & 8191) == 0) check.run();
        int mask = masks[i];
        if (mask != current) {
          close(w, current);
          open(w, mask);
          current = mask;
        }
        switch (text.charAt(i)) {
          case '&' -> w.write("&amp;");
          case '<' -> w.write("&lt;");
          case '>' -> w.write("&gt;");
          case '"' -> w.write("&quot;");
          case '\'' -> w.write("&#39;");
          default -> w.write(text.charAt(i));
        }
      }
      close(w, current);
      w.write("</pre></body></html>");
    }
  }

  private static void richHtml(NativeCodec.Decoded d, OutputStream output, Runnable check)
      throws IOException {
    try (Writer w =
        new BufferedWriter(new OutputStreamWriter(output, StandardCharsets.UTF_8), 32768)) {
      w.write(
          "<!doctype html><html><head><meta charset=\"utf-8\"><title>Export</title></head><body><main style=\"white-space:pre-wrap;font-family:Arial,sans-serif\">");
      String text = d.text();
      byte[] masks = d.masks();
      var runs = d.formatting().runs();
      var paragraphs = d.formatting().paragraphs();
      int runIndex = 0, paragraphIndex = 0, mask = 0;
      int imageIndex = 0;
      NativeCodec.FormatRun currentRun = null;
      w.write("<div style=\"text-align:");
      w.write(
          paragraphs.isEmpty() || paragraphs.get(0).from() != 0
              ? "left"
              : paragraphs.get(0).align());
      w.write(";min-height:1em\">");
      for (int i = 0; i < text.length(); i++) {
        if ((i & 8191) == 0) check.run();
        if (text.charAt(i) == '\n') {
          close(w, mask);
          mask = 0;
          if (currentRun != null) w.write("</span>");
          currentRun = null;
          w.write("</div>");
          int next = i + 1;
          while (paragraphIndex < paragraphs.size() && paragraphs.get(paragraphIndex).from() < next)
            paragraphIndex++;
          String align =
              paragraphIndex < paragraphs.size() && paragraphs.get(paragraphIndex).from() == next
                  ? paragraphs.get(paragraphIndex).align()
                  : "left";
          w.write("<div style=\"text-align:");
          w.write(align);
          w.write(";min-height:1em\">");
          continue;
        }
        while (runIndex < runs.size() && runs.get(runIndex).to() <= i) runIndex++;
        NativeCodec.FormatRun run =
            runIndex < runs.size() && runs.get(runIndex).from() <= i ? runs.get(runIndex) : null;
        int nextMask = masks[i];
        if (run != currentRun || nextMask != mask) {
          close(w, mask);
          if (currentRun != null) w.write("</span>");
          currentRun = run;
          if (run != null) {
            w.write("<span style=\"");
            if (run.font() != null) {
              w.write("font-family:'");
              w.write(run.font());
              w.write("';");
            }
            if (run.size() != null) {
              w.write("font-size:");
              w.write(Integer.toString(run.size()));
              w.write("pt;");
            }
            if (run.color() != null) {
              w.write("color:");
              w.write(run.color());
              w.write(';');
            }
            if (run.background() != null) {
              w.write("background-color:");
              w.write(run.background());
              w.write(";");
            }
            if (run.strike()) w.write("text-decoration-line:line-through;");
            if (run.script() != null) {
              w.write("vertical-align:");
              w.write(run.script());
              w.write(";font-size:");
              w.write(run.size() == null ? "0.75em" : (run.size() * 0.75) + "pt");
              w.write(";");
            }
            w.write("\">");
          }
          open(w, nextMask);
          mask = nextMask;
        }
        if (imageIndex < d.images().size() && d.images().get(imageIndex).from() == i) {
          NativeCodec.EmbeddedImage image = d.images().get(imageIndex++);
          w.write("<img alt=\"Image\" src=\"data:");
          w.write(image.mime());
          w.write(";base64,");
          w.write(image.data());
          w.write("\" width=\"");
          w.write(Integer.toString(image.width()));
          w.write("\" height=\"");
          w.write(Integer.toString(image.height()));
          w.write("\" style=\"max-width:100%;height:auto\">");
          continue;
        }
        switch (text.charAt(i)) {
          case '&' -> w.write("&amp;");
          case '<' -> w.write("&lt;");
          case '>' -> w.write("&gt;");
          case '"' -> w.write("&quot;");
          case '\'' -> w.write("&#39;");
          default -> w.write(text.charAt(i));
        }
      }
      close(w, mask);
      if (currentRun != null) w.write("</span>");
      w.write("</div></main></body></html>");
    }
  }

  private static void open(Writer w, int mask) throws IOException {
    if ((mask & 1) != 0) w.write("<b>");
    if ((mask & 2) != 0) w.write("<i>");
    if ((mask & 4) != 0) w.write("<u>");
  }

  private static void close(Writer w, int mask) throws IOException {
    if ((mask & 4) != 0) w.write("</u>");
    if ((mask & 2) != 0) w.write("</i>");
    if ((mask & 1) != 0) w.write("</b>");
  }

  static Map<String, Object> preview(String text) {
    long count = 0;
    boolean word = false;
    for (int offset = 0; offset < text.length(); ) {
      int cp = text.codePointAt(offset);
      boolean space = whiteSpace(cp);
      if (!space && !word) count++;
      word = !space;
      offset += Character.charCount(cp);
    }
    int max = text.offsetByCodePoints(0, Math.min(2000, text.codePointCount(0, text.length())));
    if (max < text.length()) {
      BreakIterator grapheme = BreakIterator.getCharacterInstance(ULocale.ROOT);
      grapheme.setText(text);
      if (!grapheme.isBoundary(max)) max = grapheme.preceding(max);
    }
    return Map.of("wordCount", count, "sampleText", text.substring(0, max));
  }

  // Unicode White_Space property, explicitly stable and independent from JVM
  // Character.isWhitespace.
  static boolean whiteSpace(int cp) {
    return (cp >= 9 && cp <= 13)
        || cp == 32
        || cp == 133
        || cp == 160
        || cp == 5760
        || (cp >= 8192 && cp <= 8202)
        || cp == 8232
        || cp == 8233
        || cp == 8239
        || cp == 8287
        || cp == 12288;
  }

  private ExportRenderer() {}
}
