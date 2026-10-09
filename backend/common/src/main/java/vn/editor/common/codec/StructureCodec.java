package vn.editor.common.codec;

import java.net.URI;
import java.util.Map;
import java.util.Set;

/** Strict V5 sparse structure validation; no HTML or document I/O. */
final class StructureCodec {
  private static final Set<String> PARAGRAPH =
      Set.of(
          "from",
          "align",
          "list",
          "indent",
          "lineSpacing",
          "spaceBefore",
          "spaceAfter",
          "pageBreak",
          "table");

  static boolean safeLink(String link) {
    if (link.length() > 2048 || link.matches("(?s).*[\\s\\x00-\\x1f\\x7f<>\"\\\\].*")) return false;
    try {
      URI uri = URI.create(link);
      String scheme = uri.getScheme();
      if (scheme == null || uri.getUserInfo() != null) return false;
      return scheme.equalsIgnoreCase("mailto")
          ? !uri.getSchemeSpecificPart().isEmpty()
          : Set.of("https", "http").contains(scheme.toLowerCase(java.util.Locale.ROOT))
              && uri.getHost() != null;
    } catch (IllegalArgumentException e) {
      return false;
    }
  }

  static NativeCodec.ParagraphFormat paragraph(
      Object value, String text, int last, boolean structured) throws NativeCodec.InvalidNative {
    if (!(value instanceof Map<?, ?> p)
        || !(structured ? PARAGRAPH : Set.of("from", "align")).containsAll(p.keySet())
        || !(p.get("from") instanceof Integer from)
        || !(p.get("align") instanceof String align)
        || from <= last
        || from < 0
        || from > text.length()
        || (from > 0 && text.charAt(from - 1) != '\n')
        || !(structured
                ? Set.of("left", "center", "right", "justify")
                : Set.of("center", "right", "justify"))
            .contains(align)
        || (align.equals("left") && p.size() == 2)) throw invalid();
    String list = null;
    if (p.containsKey("list")) {
      if (!(p.get("list") instanceof String l) || !Set.of("bullet", "number").contains(l))
        throw invalid();
      list = l;
    }
    int indent = integer(p, "indent", 0, 8),
        before = integer(p, "spaceBefore", 0, 72),
        after = integer(p, "spaceAfter", 0, 72);
    double spacing = 1.15;
    if (p.containsKey("lineSpacing")) {
      if (!(p.get("lineSpacing") instanceof Number n)
          || !Set.of(1.0, 1.15, 1.5, 2.0, 2.5, 3.0).contains(n.doubleValue())) throw invalid();
      spacing = n.doubleValue();
    }
    boolean pageBreak = bool(p, "pageBreak");
    NativeCodec.TableCell table = null;
    if (p.containsKey("table")) {
      if (!(p.get("table") instanceof Map<?, ?> t)
          || !t.keySet().equals(Set.of("id", "columns"))
          || !(t.get("id") instanceof String id)
          || !id.matches("[a-zA-Z0-9-]{1,64}")) throw invalid();
      int columns = integer(t, "columns", 0, 8);
      if (columns < 1) throw invalid();
      table = new NativeCodec.TableCell(id, columns);
    }
    return new NativeCodec.ParagraphFormat(
        from, align, list, indent, spacing, before, after, pageBreak, table);
  }

  static NativeCodec.PageSettings page(Object value) throws NativeCodec.InvalidNative {
    if (!(value instanceof Map<?, ?> p)
        || !Set.of("header", "footer", "pageNumbers").containsAll(p.keySet())) throw invalid();
    return new NativeCodec.PageSettings(
        label(p, "header"), label(p, "footer"), bool(p, "pageNumbers"));
  }

  static void tables(java.util.List<NativeCodec.ParagraphFormat> paragraphs, String text)
      throws NativeCodec.InvalidNative {
    String id = null;
    int columns = 0, count = 0, start = 0, previousEnd = -2;
    for (var p : paragraphs) {
      if (p.table() == null) {
        id = null;
        continue;
      }
      if (!p.table().id().equals(id) || p.from() != previousEnd + 1) {
        id = p.table().id();
        columns = p.table().columns();
        count = 0;
        start = p.from();
      }
      int end = text.indexOf('\n', p.from());
      if (end < 0) end = text.length();
      if (columns != p.table().columns() || ++count > 1000 || end - start > 20000) throw invalid();
      previousEnd = end;
    }
  }

  private static String label(Map<?, ?> p, String key) throws NativeCodec.InvalidNative {
    if (!p.containsKey(key)) return "";
    if (!(p.get(key) instanceof String text)
        || text.length() > 500
        || text.matches("(?s).*[\\x00-\\x1f\\x7f].*")) throw invalid();
    for (int i = 0; i < text.length(); i++)
      if (Character.isSurrogate(text.charAt(i))) {
        if (!Character.isHighSurrogate(text.charAt(i))
            || ++i >= text.length()
            || !Character.isLowSurrogate(text.charAt(i))) throw invalid();
      }
    return text;
  }

  private static int integer(Map<?, ?> p, String key, int fallback, int max)
      throws NativeCodec.InvalidNative {
    if (!p.containsKey(key)) return fallback;
    if (!(p.get(key) instanceof Integer n) || n < 0 || n > max) throw invalid();
    return n;
  }

  private static boolean bool(Map<?, ?> p, String key) throws NativeCodec.InvalidNative {
    if (!p.containsKey(key)) return false;
    if (!(p.get(key) instanceof Boolean b)) throw invalid();
    return b;
  }

  private static NativeCodec.InvalidNative invalid() {
    return new NativeCodec.InvalidNative("INVALID_NATIVE_FILE");
  }

  private StructureCodec() {}
}
