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

  public record Decoded(
      Map<String, Object> manifest,
      String text,
      byte[] masks,
      int nativeBytes,
      String nativeSha256) {}

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
    if (entries.size() != 3) throw new InvalidNative("INVALID_NATIVE_FILE");
    Map<String, Object> m;
    try {
      m = JSON.readValue(strictUtf8(entries.get("manifest.json")), Map.class);
    } catch (Exception ex) {
      throw new InvalidNative("INVALID_NATIVE_FILE");
    }
    if (m == null
        || !m.keySet().equals(FIELDS)
        || !Objects.equals(m.get("schemaVersion"), 1)
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
    BreakIterator graphemes = BreakIterator.getCharacterInstance(ULocale.ROOT);
    graphemes.setText(text);
    for (int from = graphemes.first(), to = graphemes.next();
        to != BreakIterator.DONE;
        from = to, to = graphemes.next())
      for (int i = from + 1; i < to; i++)
        if (masks[i] != masks[from]) throw new InvalidNative("INVALID_NATIVE_FILE");
    return new Decoded(
        Collections.unmodifiableMap(m), text, masks, archive.length, sha256(archive));
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
        || Short.toUnsignedInt(b.getShort(end + 8)) != 3
        || Short.toUnsignedInt(b.getShort(end + 10)) != 3)
      throw new InvalidNative("INVALID_NATIVE_FILE");
    long central = Integer.toUnsignedLong(b.getInt(end + 16)),
        length = Integer.toUnsignedLong(b.getInt(end + 12));
    if (central + length != end) throw new InvalidNative("INVALID_NATIVE_FILE");
    int p = (int) central;
    Set<String> names = new HashSet<>();
    List<long[]> regions = new ArrayList<>();
    for (int i = 0; i < 3; i++) {
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
      if (!Set.of("manifest.json", "text.utf8", "styles.bin").contains(name) || !names.add(name))
        throw new InvalidNative("INVALID_NATIVE_FILE");
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
