package vn.editor.common.codec;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.ibm.icu.text.BreakIterator;
import com.ibm.icu.util.ULocale;
import java.io.IOException;
import java.io.InputStream;
import java.nio.BufferUnderflowException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Collections;
import java.util.Comparator;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipException;
import java.util.zip.ZipFile;

/** Bounded adaptive-v1 decoder shared by validators and processing, never by SQL models. */
public final class NativeCodec {
  public static final int MAX_NATIVE = 33554432, MAX_TEXT = 10485760, MAX_STYLES = 8388608;
  private static final ObjectMapper JSON =
      new ObjectMapper()
          .enable(com.fasterxml.jackson.core.JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
          .enable(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
  private static final Set<String> FIELDS =
      Set.of(
          "schemaVersion",
          "textEncoding",
          "internalEol",
          "preferredExportEol",
          "exportBom",
          "offsetUnit",
          "utf8Bytes",
          "utf16Length",
          "logicalLines",
          "stylesEncoding",
          "textSha256",
          "stylesSha256");
  private static final Set<String> RICH_FIELDS =
      Set.of(
          "schemaVersion",
          "textEncoding",
          "internalEol",
          "preferredExportEol",
          "exportBom",
          "offsetUnit",
          "utf8Bytes",
          "utf16Length",
          "logicalLines",
          "stylesEncoding",
          "textSha256",
          "stylesSha256",
          "formattingEncoding",
          "formattingSha256");
  private static final Set<String> IMAGE_FIELDS =
      Set.of(
          "schemaVersion",
          "textEncoding",
          "internalEol",
          "preferredExportEol",
          "exportBom",
          "offsetUnit",
          "utf8Bytes",
          "utf16Length",
          "logicalLines",
          "stylesEncoding",
          "textSha256",
          "stylesSha256",
          "formattingEncoding",
          "formattingSha256",
          "mediaEncoding",
          "mediaSha256");

  public record FormatRun(
      int from,
      int to,
      String font,
      Integer size,
      String color,
      String background,
      boolean strike,
      String script,
      String link) {
    public FormatRun(
        int from,
        int to,
        String font,
        Integer size,
        String color,
        String background,
        boolean strike,
        String script) {
      this(from, to, font, size, color, background, strike, script, null);
    }

    public FormatRun(int from, int to, String font, Integer size, String color) {
      this(from, to, font, size, color, null, false, null, null);
    }
  }

  public record TableCell(String id, int columns) {}

  public record PageSettings(String header, String footer, boolean pageNumbers) {
    public static PageSettings empty() {
      return new PageSettings("", "", false);
    }
  }

  public record ParagraphFormat(
      int from,
      String align,
      String list,
      int indent,
      double lineSpacing,
      int spaceBefore,
      int spaceAfter,
      boolean pageBreak,
      TableCell table) {
    public ParagraphFormat(int from, String align) {
      this(from, align, null, 0, 1.15, 0, 0, false, null);
    }
  }

  public record EmbeddedImage(
      int from, String id, String mime, int width, int height, String data) {}

  public record Formatting(
      List<FormatRun> runs, List<ParagraphFormat> paragraphs, PageSettings page) {
    public Formatting(List<FormatRun> runs, List<ParagraphFormat> paragraphs) {
      this(runs, paragraphs, PageSettings.empty());
    }

    public static Formatting empty() {
      return new Formatting(List.of(), List.of());
    }
  }

  public record Decoded(
      Map<String, Object> manifest,
      String text,
      byte[] masks,
      int nativeBytes,
      String nativeSha256,
      Formatting formatting,
      List<EmbeddedImage> images) {
    public Decoded(
        Map<String, Object> manifest,
        String text,
        byte[] masks,
        int nativeBytes,
        String nativeSha256) {
      this(manifest, text, masks, nativeBytes, nativeSha256, Formatting.empty(), List.of());
    }

    public Decoded(
        Map<String, Object> manifest,
        String text,
        byte[] masks,
        int nativeBytes,
        String nativeSha256,
        Formatting formatting) {
      this(manifest, text, masks, nativeBytes, nativeSha256, formatting, List.of());
    }
  }

  public static Decoded decode(Path path) throws IOException {
    long size = Files.size(path);
    if (size > MAX_NATIVE) throw new InvalidNative("FILE_TOO_LARGE");
    byte[] archive = Files.readAllBytes(path);
    validateZip(archive);
    Map<String, byte[]> entries = new HashMap<>();
    try (ZipFile zip = new ZipFile(path.toFile(), StandardCharsets.UTF_8)) {
      Enumeration<? extends ZipEntry> iterator = zip.entries();
      while (iterator.hasMoreElements()) {
        ZipEntry e = iterator.nextElement();
        int cap =
            switch (e.getName()) {
              case "manifest.json" -> 65536;
              case "text.utf8" -> MAX_TEXT;
              case "styles.bin" -> MAX_STYLES;
              case "formatting.json" -> MAX_STYLES;
              case "media.json" -> MAX_STYLES;
              default -> throw new InvalidNative("INVALID_NATIVE_FILE");
            };
        if (e.getMethod() != ZipEntry.STORED
            || e.getSize() < 0
            || e.getSize() > cap
            || entries.containsKey(e.getName())) throw new InvalidNative("INVALID_NATIVE_FILE");
        byte[] bytes;
        try (InputStream in = zip.getInputStream(e)) {
          bytes = in.readNBytes(cap + 1);
        }
        CRC32 crc = new CRC32();
        crc.update(bytes);
        if (bytes.length != e.getSize() || crc.getValue() != e.getCrc())
          throw new InvalidNative("INVALID_NATIVE_FILE");
        entries.put(e.getName(), bytes);
      }
    } catch (ZipException ex) {
      throw new InvalidNative("INVALID_NATIVE_FILE");
    }
    if (entries.size() < 3 || entries.size() > 5) throw new InvalidNative("INVALID_NATIVE_FILE");
    Map<String, Object> m;
    try {
      m = JSON.readValue(strictUtf8(entries.get("manifest.json")), Map.class);
    } catch (Exception ex) {
      throw new InvalidNative("INVALID_NATIVE_FILE");
    }
    boolean structured = m != null && Objects.equals(m.get("schemaVersion"), 5);
    boolean extended = m != null && (Objects.equals(m.get("schemaVersion"), 4) || structured);
    boolean media = m != null && (Objects.equals(m.get("schemaVersion"), 3) || extended);
    boolean rich = m != null && (Objects.equals(m.get("schemaVersion"), 2) || media);
    if (m == null
        || !m.keySet().equals(media ? IMAGE_FIELDS : rich ? RICH_FIELDS : FIELDS)
        || (!rich && !Objects.equals(m.get("schemaVersion"), 1))
        || entries.containsKey("formatting.json") != rich
        || entries.containsKey("media.json") != media
        || (media
            && (!Objects.equals(m.get("mediaEncoding"), "embedded-v1")
                || !Objects.equals(m.get("mediaSha256"), sha256(entries.get("media.json")))))
        || (rich
            && (!Objects.equals(
                    m.get("formattingEncoding"),
                    structured ? "sparse-v3" : extended ? "sparse-v2" : "sparse-v1")
                || !Objects.equals(
                    m.get("formattingSha256"), sha256(entries.get("formatting.json")))))
        || !Objects.equals(m.get("textEncoding"), "utf-8")
        || !Objects.equals(m.get("internalEol"), "LF")
        || !Objects.equals(m.get("offsetUnit"), "utf16")
        || !Objects.equals(m.get("stylesEncoding"), "adaptive-v1")
        || !(m.get("exportBom") instanceof Boolean)
        || !("LF".equals(m.get("preferredExportEol"))
            || "CRLF".equals(m.get("preferredExportEol"))))
      throw new InvalidNative("INVALID_NATIVE_FILE");
    byte[] raw = entries.get("text.utf8"), styles = entries.get("styles.bin");
    String text = strictUtf8(raw);
    if (text.startsWith("\ufeff") || text.indexOf('\r') >= 0)
      throw new InvalidNative("INVALID_NATIVE_FILE");
    int lines = 1;
    for (int i = 0; i < text.length(); i++) if (text.charAt(i) == '\n') lines++;
    if (lines > 1000000 || text.length() > MAX_TEXT) throw new InvalidNative("FILE_TOO_LARGE");
    if (!Objects.equals(m.get("utf8Bytes"), raw.length)
        || !Objects.equals(m.get("utf16Length"), text.length())
        || !Objects.equals(m.get("logicalLines"), lines)
        || !Objects.equals(m.get("textSha256"), sha256(raw))
        || !Objects.equals(m.get("stylesSha256"), sha256(styles)))
      throw new InvalidNative("INVALID_NATIVE_FILE");
    byte[] masks = decodeStyles(styles, text.length());
    Formatting formatting =
        rich
            ? decodeFormatting(entries.get("formatting.json"), text, extended, structured)
            : Formatting.empty();
    List<EmbeddedImage> images = media ? decodeImages(entries.get("media.json"), text) : List.of();
    BreakIterator graphemes = BreakIterator.getCharacterInstance(ULocale.ROOT);
    graphemes.setText(text);
    for (int from = graphemes.first(), to = graphemes.next();
        to != BreakIterator.DONE;
        from = to, to = graphemes.next())
      for (int i = from + 1; i < to; i++)
        if (masks[i] != masks[from]) throw new InvalidNative("INVALID_NATIVE_FILE");
    return new Decoded(
        Collections.unmodifiableMap(m),
        text,
        masks,
        archive.length,
        sha256(archive),
        formatting,
        images);
  }

  private static List<EmbeddedImage> decodeImages(byte[] raw, String text) throws InvalidNative {
    try {
      Map<?, ?> root = JSON.readValue(strictUtf8(raw), Map.class);
      if (root == null
          || !root.keySet().equals(Set.of("images"))
          || !(root.get("images") instanceof List<?> rows)
          || rows.size() > 100) throw new InvalidNative("INVALID_NATIVE_FILE");
      List<EmbeddedImage> images = new ArrayList<>();
      Set<String> ids = new HashSet<>();
      int previous = -1;
      for (Object value : rows) {
        if (!(value instanceof Map<?, ?> row)
            || !row.keySet().equals(Set.of("from", "id", "mime", "width", "height", "data"))
            || !(row.get("from") instanceof Integer from)
            || !(row.get("id") instanceof String id)
            || !(row.get("mime") instanceof String mime)
            || !(row.get("width") instanceof Integer width)
            || !(row.get("height") instanceof Integer height)
            || !(row.get("data") instanceof String data)
            || from <= previous
            || from >= text.length()
            || text.charAt(from) != '\ufffc'
            || !id.matches("[0-9a-fA-F-]{36}")
            || !ids.add(id)
            || !Set.of("image/png", "image/jpeg").contains(mime)
            || width < 1
            || height < 1
            || width > 4096
            || height > 4096
            || data.length() > 2796204) throw new InvalidNative("INVALID_NATIVE_FILE");
        byte[] bytes = Base64.getDecoder().decode(data);
        if (bytes.length == 0
            || bytes.length > 2097152
            || !Base64.getEncoder().encodeToString(bytes).equals(data))
          throw new InvalidNative("INVALID_NATIVE_FILE");
        int[] dimensions = imageDimensions(bytes, mime);
        if (dimensions == null || dimensions[0] != width || dimensions[1] != height)
          throw new InvalidNative("INVALID_NATIVE_FILE");
        images.add(new EmbeddedImage(from, id, mime, width, height, data));
        previous = from;
      }
      return List.copyOf(images);
    } catch (IOException | IllegalArgumentException ex) {
      throw new InvalidNative("INVALID_NATIVE_FILE");
    }
  }

  private static int[] imageDimensions(byte[] bytes, String mime) {
    if (mime.equals("image/png")) {
      byte[] signature = {(byte) 137, 80, 78, 71, 13, 10, 26, 10};
      if (bytes.length < 24
          || !Arrays.equals(Arrays.copyOf(bytes, 8), signature)
          || !Arrays.equals(
              Arrays.copyOfRange(bytes, 12, 16), "IHDR".getBytes(StandardCharsets.US_ASCII)))
        return null;
      ByteBuffer view = ByteBuffer.wrap(bytes).order(ByteOrder.BIG_ENDIAN);
      return new int[] {view.getInt(16), view.getInt(20)};
    }
    if (bytes.length < 4 || (bytes[0] & 255) != 255 || (bytes[1] & 255) != 216) return null;
    for (int p = 2; p + 9 < bytes.length; ) {
      if ((bytes[p++] & 255) != 255) return null;
      int marker = bytes[p++] & 255;
      while (marker == 255 && p < bytes.length) marker = bytes[p++] & 255;
      if (marker == 217 || marker == 218 || p + 2 > bytes.length) return null;
      if (marker == 1 || (marker >= 208 && marker <= 215)) continue;
      int size = ((bytes[p] & 255) << 8) | (bytes[p + 1] & 255);
      if (size < 2 || p + size > bytes.length) return null;
      if (marker >= 192 && marker <= 195 && size >= 7)
        return new int[] {
          ((bytes[p + 5] & 255) << 8) | (bytes[p + 6] & 255),
          ((bytes[p + 3] & 255) << 8) | (bytes[p + 4] & 255)
        };
      p += size;
    }
    return null;
  }

  private static Formatting decodeFormatting(
      byte[] raw, String text, boolean extended, boolean structured) throws InvalidNative {
    try {
      Map<?, ?> data = JSON.readValue(strictUtf8(raw), Map.class);
      if (data == null
          || !data.keySet()
              .equals(
                  structured && data.containsKey("page")
                      ? Set.of("runs", "paragraphs", "page")
                      : Set.of("runs", "paragraphs")))
        throw new InvalidNative("INVALID_NATIVE_FILE");
      if (!(data.get("runs") instanceof List<?> rows)
          || !(data.get("paragraphs") instanceof List<?> lines)
          || rows.size() > 100000
          || lines.size() > 100000) throw new InvalidNative("INVALID_NATIVE_FILE");
      List<FormatRun> runs = new ArrayList<>();
      BreakIterator boundaries = BreakIterator.getCharacterInstance(ULocale.ROOT);
      boundaries.setText(text);
      int last = 0;
      for (Object value : rows) {
        if (!(value instanceof Map<?, ?> r)
            || !r.keySet().containsAll(Set.of("from", "to"))
            || !(structured
                    ? Set.of(
                        "from",
                        "to",
                        "font",
                        "size",
                        "color",
                        "background",
                        "strike",
                        "script",
                        "link")
                    : extended
                        ? Set.of(
                            "from", "to", "font", "size", "color", "background", "strike", "script")
                        : Set.of("from", "to", "font", "size", "color"))
                .containsAll(r.keySet())
            || !(r.get("from") instanceof Integer from)
            || !(r.get("to") instanceof Integer to)
            || from < last
            || to <= from
            || to > text.length()) throw new InvalidNative("INVALID_NATIVE_FILE");
        if (!boundaries.isBoundary(from) || !boundaries.isBoundary(to))
          throw new InvalidNative("INVALID_NATIVE_FILE");
        String font = r.get("font") instanceof String f ? f : null;
        Integer size = r.get("size") instanceof Integer s ? s : null;
        String color = r.get("color") instanceof String c ? c : null;
        String background = r.get("background") instanceof String b ? b : null;
        String script = r.get("script") instanceof String s ? s : null;
        boolean strike = Boolean.TRUE.equals(r.get("strike"));
        String link = r.get("link") instanceof String l ? l : null;
        if ((r.containsKey("link") && (link == null || !StructureCodec.safeLink(link)))
            || (r.containsKey("font") && font == null)
            || (r.containsKey("size") && size == null)
            || (r.containsKey("color") && color == null)
            || (r.containsKey("background") && background == null)
            || (r.containsKey("script") && script == null && link == null)
            || (r.containsKey("strike") && !(r.get("strike") instanceof Boolean))
            || (background != null && !background.matches("#[0-9a-fA-F]{6}"))
            || (script != null && !Set.of("super", "sub").contains(script))
            || (font == null
                && size == null
                && color == null
                && background == null
                && !strike
                && script == null
                && link == null)
            || (font != null
                && !Set.of("Arial", "Times New Roman", "Georgia", "Verdana", "Courier New")
                    .contains(font))
            || (size != null && (size < 8 || size > 72))
            || (color != null && !color.matches("#[0-9a-fA-F]{6}")))
          throw new InvalidNative("INVALID_NATIVE_FILE");
        runs.add(new FormatRun(from, to, font, size, color, background, strike, script, link));
        last = to;
      }
      List<ParagraphFormat> paragraphs = new ArrayList<>();
      last = -1;
      for (Object value : lines) {
        ParagraphFormat paragraph = StructureCodec.paragraph(value, text, last, structured);
        paragraphs.add(paragraph);
        last = paragraph.from();
      }
      StructureCodec.tables(paragraphs, text);
      return new Formatting(
          List.copyOf(runs),
          List.copyOf(paragraphs),
          data.containsKey("page") ? StructureCodec.page(data.get("page")) : PageSettings.empty());
    } catch (IOException | ClassCastException ex) {
      throw new InvalidNative("INVALID_NATIVE_FILE");
    }
  }

  private static void validateZip(byte[] a) throws InvalidNative {
    if (a.length < 22) throw new InvalidNative("INVALID_NATIVE_FILE");
    ByteBuffer b = ByteBuffer.wrap(a).order(ByteOrder.LITTLE_ENDIAN);
    int end = -1;
    for (int p = a.length - 22; p >= Math.max(0, a.length - 65557); p--)
      if (b.getInt(p) == 0x06054b50
          && p + 22 + Short.toUnsignedInt(b.getShort(p + 20)) == a.length) {
        end = p;
        break;
      }
    if (end < 0
        || b.getShort(end + 4) != 0
        || b.getShort(end + 6) != 0
        || !Set.of(3, 4, 5).contains(Short.toUnsignedInt(b.getShort(end + 8)))
        || b.getShort(end + 10) != b.getShort(end + 8))
      throw new InvalidNative("INVALID_NATIVE_FILE");
    long central = Integer.toUnsignedLong(b.getInt(end + 16)),
        length = Integer.toUnsignedLong(b.getInt(end + 12));
    if (central + length != end) throw new InvalidNative("INVALID_NATIVE_FILE");
    int p = (int) central;
    Set<String> names = new HashSet<>();
    List<long[]> regions = new ArrayList<>();
    for (int i = 0; i < Short.toUnsignedInt(b.getShort(end + 8)); i++) {
      if (p < 0 || p + 46 > end || b.getInt(p) != 0x02014b50)
        throw new InvalidNative("INVALID_NATIVE_FILE");
      int flags = Short.toUnsignedInt(b.getShort(p + 8)),
          method = Short.toUnsignedInt(b.getShort(p + 10)),
          n = Short.toUnsignedInt(b.getShort(p + 28)),
          extra = Short.toUnsignedInt(b.getShort(p + 30)),
          comment = Short.toUnsignedInt(b.getShort(p + 32));
      int mode = (b.getInt(p + 38) >>> 16) & 0170000;
      if ((flags & ~0x808) != 0
          || method != 0
          || mode == 0120000
          || p + 46 + n + extra + comment > end) throw new InvalidNative("INVALID_NATIVE_FILE");
      String name = new String(a, p + 46, n, StandardCharsets.UTF_8);
      if (!Set.of("manifest.json", "text.utf8", "styles.bin", "formatting.json", "media.json")
              .contains(name)
          || !names.add(name)) throw new InvalidNative("INVALID_NATIVE_FILE");
      long local = Integer.toUnsignedLong(b.getInt(p + 42));
      if (local + 30 > central || b.getInt((int) local) != 0x04034b50)
        throw new InvalidNative("INVALID_NATIVE_FILE");
      int l = (int) local,
          ln = Short.toUnsignedInt(b.getShort(l + 26)),
          le = Short.toUnsignedInt(b.getShort(l + 28));
      if (b.getShort(l + 6) != b.getShort(p + 8)
          || b.getShort(l + 8) != 0
          || l + 30 + ln + le > central
          || !name.equals(new String(a, l + 30, ln, StandardCharsets.UTF_8)))
        throw new InvalidNative("INVALID_NATIVE_FILE");
      long compressed = Integer.toUnsignedLong(b.getInt(p + 20)),
          uncompressed = Integer.toUnsignedLong(b.getInt(p + 24));
      if (compressed != uncompressed || local + 30 + ln + le + compressed > central)
        throw new InvalidNative("INVALID_NATIVE_FILE");
      long regionEnd = local + 30 + ln + le + compressed;
      if ((flags & 8) != 0) {
        int descriptor = (int) regionEnd;
        if (descriptor + 12 > central) throw new InvalidNative("INVALID_NATIVE_FILE");
        if (b.getInt(descriptor) == 0x08074b50) descriptor += 4;
        if (descriptor + 12 > central
            || b.getInt(descriptor) != b.getInt(p + 16)
            || b.getInt(descriptor + 4) != b.getInt(p + 20)
            || b.getInt(descriptor + 8) != b.getInt(p + 24))
          throw new InvalidNative("INVALID_NATIVE_FILE");
        regionEnd = descriptor + 12;
      } else if (b.getInt(l + 14) != b.getInt(p + 16)
          || b.getInt(l + 18) != b.getInt(p + 20)
          || b.getInt(l + 22) != b.getInt(p + 24)) throw new InvalidNative("INVALID_NATIVE_FILE");
      regions.add(new long[] {local, regionEnd});
      p += 46 + n + extra + comment;
    }
    if (p != end) throw new InvalidNative("INVALID_NATIVE_FILE");
    regions.sort(Comparator.comparingLong(region -> region[0]));
    long covered = 0;
    for (long[] region : regions) {
      if (region[0] != covered) throw new InvalidNative("INVALID_NATIVE_FILE");
      covered = region[1];
    }
    if (covered != central) throw new InvalidNative("INVALID_NATIVE_FILE");
  }

  public static byte[] decodeStyles(byte[] raw, int expected) throws InvalidNative {
    try {
      ByteBuffer b = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN);
      byte[] magic = new byte[8];
      b.get(magic);
      if (!Arrays.equals(magic, "TEDSTYLE".getBytes(StandardCharsets.US_ASCII))
          || b.getShort() != 1
          || b.getShort() != 0
          || b.getInt() != expected) throw new InvalidNative("INVALID_NATIVE_FILE");
      long records = Integer.toUnsignedLong(b.getInt());
      if (records > expected || (expected == 0) != (records == 0))
        throw new InvalidNative("INVALID_NATIVE_FILE");
      byte[] masks = new byte[expected];
      int pos = 0;
      for (long r = 0; r < records; r++) {
        int tag = Byte.toUnsignedInt(b.get()), len = varint(b);
        if (len <= 0 || len > expected - pos) throw new InvalidNative("INVALID_NATIVE_FILE");
        switch (tag) {
          case 0 -> {
            byte mask = mask(b);
            Arrays.fill(masks, pos, pos + len, mask);
          }
          case 1 -> {
            int count = varint(b), used = 0;
            if (count <= 0 || count > len) throw new InvalidNative("INVALID_NATIVE_FILE");
            for (int j = 0; j < count; j++) {
              int run = varint(b);
              byte mask = mask(b);
              if (run <= 0 || run > len - used) throw new InvalidNative("INVALID_NATIVE_FILE");
              Arrays.fill(masks, pos + used, pos + used + run, mask);
              used += run;
            }
            if (used != len) throw new InvalidNative("INVALID_NATIVE_FILE");
          }
          case 2 -> {
            for (int plane = 0; plane < 3; plane++)
              for (int start = 0; start < len; start += 32) {
                int word = b.getInt(), bits = Math.min(32, len - start);
                if (bits < 32 && (word >>> bits) != 0)
                  throw new InvalidNative("INVALID_NATIVE_FILE");
                for (int k = 0; k < bits; k++)
                  if ((word & (1 << k)) != 0) masks[pos + start + k] |= (byte) (1 << plane);
              }
          }
          default -> throw new InvalidNative("INVALID_NATIVE_FILE");
        }
        pos += len;
      }
      if (pos != expected || b.hasRemaining()) throw new InvalidNative("INVALID_NATIVE_FILE");
      return masks;
    } catch (BufferUnderflowException | IndexOutOfBoundsException ex) {
      throw new InvalidNative("INVALID_NATIVE_FILE");
    }
  }

  private static byte mask(ByteBuffer b) throws InvalidNative {
    byte m = b.get();
    if (m < 0 || m > 7) throw new InvalidNative("INVALID_NATIVE_FILE");
    return m;
  }

  private static int varint(ByteBuffer b) throws InvalidNative {
    long n = 0;
    for (int i = 0; i < 5; i++) {
      int v = Byte.toUnsignedInt(b.get());
      n |= (long) (v & 127) << (7 * i);
      if ((v & 128) == 0) {
        if ((i > 0 && v == 0) || n > Integer.MAX_VALUE)
          throw new InvalidNative("INVALID_NATIVE_FILE");
        return (int) n;
      }
    }
    throw new InvalidNative("INVALID_NATIVE_FILE");
  }

  private static String strictUtf8(byte[] b) throws InvalidNative {
    try {
      return StandardCharsets.UTF_8
          .newDecoder()
          .onMalformedInput(CodingErrorAction.REPORT)
          .onUnmappableCharacter(CodingErrorAction.REPORT)
          .decode(ByteBuffer.wrap(b))
          .toString();
    } catch (CharacterCodingException ex) {
      throw new InvalidNative("INVALID_NATIVE_FILE");
    }
  }

  public static String sha256(byte[] b) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(b));
    } catch (NoSuchAlgorithmException ex) {
      throw new IllegalStateException(ex);
    }
  }

  public static String sha256(InputStream in) throws IOException {
    try {
      MessageDigest md = MessageDigest.getInstance("SHA-256");
      byte[] b = new byte[65536];
      for (int n; (n = in.read(b)) != -1; ) md.update(b, 0, n);
      return HexFormat.of().formatHex(md.digest());
    } catch (NoSuchAlgorithmException ex) {
      throw new IllegalStateException(ex);
    }
  }

  public static final class InvalidNative extends IOException {
    public final String code;

    public InvalidNative(String code) {
      super(code);
      this.code = code;
    }
  }

  private NativeCodec() {}
}
