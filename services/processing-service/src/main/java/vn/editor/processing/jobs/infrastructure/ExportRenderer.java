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
      for (int from = 0; from < text.length(); ) {
        check.run();
        int to = Math.min(from + 32768, text.length());
        if (to < text.length() && Character.isHighSurrogate(text.charAt(to - 1))) to--;
        for (int i = from; i < to; i++) {
          char c = text.charAt(i);
          if (crlf && c == '\n') w.write('\r');
          w.write(c);
        }
        from = to;
      }
    }
  }

  static void html(NativeCodec.Decoded d, OutputStream output, Runnable check) throws IOException {
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
