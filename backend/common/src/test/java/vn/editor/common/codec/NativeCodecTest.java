package vn.editor.common.codec;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Random;
import java.util.UUID;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import vn.editor.common.messaging.EventSchemas;
import vn.editor.common.storage.LocalStorage;
import vn.editor.common.storage.StorageProvider;

class NativeCodecTest {
  @TempDir Path temp;

  @Test
  void denseAndRunsPropertyAgainstFlatOracle() throws Exception {
    Random random = new Random(42);
    for (int trial = 0; trial < 500; trial++) {
      int n = random.nextInt(800) + 1;
      byte[] expected = new byte[n];
      random.nextBytes(expected);
      for (int i = 0; i < n; i++) expected[i] &= 7;
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      out.write("TEDSTYLE".getBytes(StandardCharsets.US_ASCII));
      out.write(
          ByteBuffer.allocate(12)
              .order(ByteOrder.LITTLE_ENDIAN)
              .putShort((short) 1)
              .putShort((short) 0)
              .putInt(n)
              .putInt(1)
              .array());
      out.write(2);
      leb(out, n);
      for (int plane = 0; plane < 3; plane++)
        for (int start = 0; start < n; start += 32) {
          int word = 0;
          for (int bit = 0; bit < Math.min(32, n - start); bit++)
            if ((expected[start + bit] & (1 << plane)) != 0) word |= 1 << bit;
          out.write(ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(word).array());
        }
      assertArrayEquals(expected, NativeCodec.decodeStyles(out.toByteArray(), n));
      byte[] trailing = Arrays.copyOf(out.toByteArray(), out.size() + 1);
      assertThrows(NativeCodec.InvalidNative.class, () -> NativeCodec.decodeStyles(trailing, n));
    }
  }

  static void leb(OutputStream out, int n) throws IOException {
    do {
      int v = n & 127;
      n >>>= 7;
      out.write(v | (n > 0 ? 128 : 0));
    } while (n > 0);
  }

  @Test
  void splitGraphemeAndInvalidUtf8AreRejected() throws Exception {
    assertThrows(
        NativeCodec.InvalidNative.class,
        () -> NativeCodec.decode(nativeFile("A😀e\u0301👩\u200d💻🇻🇳\nक्\u200dष", true)));
    var valid = NativeCodec.decode(nativeFile("A😀e\u0301👩\u200d💻🇻🇳\nक्\u200dष", false));
    assertTrue(valid.text().contains("😀"));
  }

  Path nativeFile(String text, boolean split) throws Exception {
    return nativeFile(text, split, null);
  }

  @Test
  void nativeV2ValidatesRichFormattingAndStillAcceptsV1() throws Exception {
    String formatting =
        "{\"runs\":[{\"from\":0,\"to\":5,\"font\":\"Georgia\",\"size\":18,\"color\":\"#aabbcc\"}],\"paragraphs\":[{\"from\":0,\"align\":\"center\"}]}";
    var decoded = NativeCodec.decode(nativeFile("Hello\nworld", false, formatting));
    assertTrue(decoded.manifest().get("schemaVersion").equals(2));
    assertTrue(decoded.formatting().runs().get(0).font().equals("Georgia"));
    assertTrue(decoded.formatting().paragraphs().get(0).align().equals("center"));
    assertTrue(NativeCodec.decode(nativeFile("Hello", false)).formatting().runs().isEmpty());
    assertThrows(
        NativeCodec.InvalidNative.class,
        () ->
            NativeCodec.decode(
                nativeFile(
                    "Hello",
                    false,
                    "{\"runs\":[{\"from\":0,\"to\":5,\"color\":\"red\"}],\"paragraphs\":[]}")));
  }

  Path nativeFile(String text, boolean split, String formatting) throws Exception {
    return nativeFile(text, split, formatting, null);
  }

  @Test
  void nativeV3ValidatesEmbeddedImage() throws Exception {
    String png =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
    String media =
        "{\"images\":[{\"from\":1,\"id\":\"c7400587-68dd-4afa-a90e-358783bf2dc0\",\"mime\":\"image/png\",\"width\":1,\"height\":1,\"data\":\""
            + png
            + "\"}]}";
    var decoded =
        NativeCodec.decode(nativeFile("A\ufffcB", false, "{\"runs\":[],\"paragraphs\":[]}", media));
    assertTrue(decoded.images().size() == 1);
    assertTrue(decoded.images().get(0).width() == 1);
    assertThrows(
        NativeCodec.InvalidNative.class,
        () ->
            NativeCodec.decode(nativeFile("ABC", false, "{\"runs\":[],\"paragraphs\":[]}", media)));
  }

  Path nativeFile(String text, boolean split, String formatting, String media) throws Exception {
    return nativeFile(
        text, split, formatting, media, media != null ? 3 : formatting == null ? 1 : 2);
  }

  @Test
  void nativeV4ValidatesNewFieldsWithoutRelaxingLegacyFiles() throws Exception {
    String format =
        "{\"runs\":[{\"from\":0,\"to\":5,\"background\":\"#ffff00\",\"strike\":true,\"script\":\"super\"}],\"paragraphs\":[]}";
    var decoded = NativeCodec.decode(nativeFile("Hello", false, format, "{\"images\":[]}", 4));
    assertTrue(decoded.formatting().runs().get(0).background().equals("#ffff00"));
    assertTrue(decoded.formatting().runs().get(0).strike());
    assertTrue(decoded.formatting().runs().get(0).script().equals("super"));
    assertThrows(
        NativeCodec.InvalidNative.class,
        () -> NativeCodec.decode(nativeFile("Hello", false, format, "{\"images\":[]}", 3)));
    for (String invalid :
        new String[] {
          format.replace("#ffff00", "url(javascript:1)"),
          format.replace("true", "\"true\""),
          format.replace("super", "normal"),
          format.replace("\"strike\":true", "\"onclick\":true")
        }) {
      assertThrows(
          NativeCodec.InvalidNative.class,
          () -> NativeCodec.decode(nativeFile("Hello", false, invalid, "{\"images\":[]}", 4)));
    }
  }

  @Test
  void nativeV4RejectsCharacterFormattingInsideSurrogateClusters() throws Exception {
    assertThrows(
        NativeCodec.InvalidNative.class,
        () ->
            NativeCodec.decode(
                nativeFile(
                    "A😀B",
                    false,
                    "{\"runs\":[{\"from\":2,\"to\":3,\"background\":\"#ffff00\"}],\"paragraphs\":[]}",
                    "{\"images\":[]}",
                    4)));
  }

  @Test
  void v5StructureIsStrictAndBackwardReadersRejectIt() throws Exception {
    String formatting =
        """
      {"runs":[{"from":0,"to":5,"link":"https://example.com"}],"paragraphs":[{"from":0,"align":"left","list":"number","indent":2,"lineSpacing":2,"pageBreak":true},{"from":6,"align":"left","table":{"id":"table","columns":2}}],"page":{"header":"Header Việt","footer":"Footer","pageNumbers":true}}
      """;
    var valid =
        NativeCodec.decode(nativeFile("Hello\nworld", false, formatting, "{\"images\":[]}", 5));
    assertTrue(valid.formatting().page().pageNumbers());
    assertTrue(valid.formatting().paragraphs().getFirst().pageBreak());
    assertTrue(valid.formatting().runs().getFirst().link().equals("https://example.com"));
    assertThrows(
        NativeCodec.InvalidNative.class,
        () ->
            NativeCodec.decode(
                nativeFile("Hello\nworld", false, formatting, "{\"images\":[]}", 4)));
    for (String bad :
        new String[] {
          formatting.replace("https://example.com", "javascript:alert(1)"),
          formatting.replace("\"indent\":2", "\"indent\":9"),
          formatting.replace("\"lineSpacing\":2", "\"lineSpacing\":1.3"),
          formatting.replace("\"pageBreak\":true", "\"pageBreak\":1"),
          formatting.replace("\"columns\":2", "\"columns\":0"),
          formatting.replace("\"header\":\"Header Việt\"", "\"header\":\"bad\\n\""),
          formatting.replace("\"pageNumbers\":true", "\"pageNumbers\":true,\"unknown\":1")
        })
      assertThrows(
          NativeCodec.InvalidNative.class,
          () -> NativeCodec.decode(nativeFile("Hello\nworld", false, bad, "{\"images\":[]}", 5)));
  }

  @Test
  void nativeTablesCannotBypassTheBoundedEditorProjection() throws Exception {
    String format =
        "{\"runs\":[],\"paragraphs\":[{\"from\":0,\"align\":\"left\",\"table\":{\"id\":\"table\",\"columns\":2}}]}";
    assertThrows(
        NativeCodec.InvalidNative.class,
        () ->
            NativeCodec.decode(nativeFile("x".repeat(20001), false, format, "{\"images\":[]}", 5)));
    String mismatched =
        "{\"runs\":[],\"paragraphs\":[{\"from\":0,\"align\":\"left\",\"table\":{\"id\":\"table\",\"columns\":2}},{\"from\":2,\"align\":\"left\",\"table\":{\"id\":\"table\",\"columns\":3}}]}";
    assertThrows(
        NativeCodec.InvalidNative.class,
        () -> NativeCodec.decode(nativeFile("a\nb", false, mismatched, "{\"images\":[]}", 5)));
  }

  Path nativeFile(String text, boolean split, String formatting, String media, int version)
      throws Exception {
    byte[] raw = text.getBytes(StandardCharsets.UTF_8);
    ByteArrayOutputStream styles = new ByteArrayOutputStream();
    styles.write("TEDSTYLE".getBytes(StandardCharsets.US_ASCII));
    styles.write(
        ByteBuffer.allocate(12)
            .order(ByteOrder.LITTLE_ENDIAN)
            .putShort((short) 1)
            .putShort((short) 0)
            .putInt(text.length())
            .putInt(1)
            .array());
    styles.write(1);
    leb(styles, text.length());
    leb(styles, text.length());
    for (int i = 0; i < text.length(); i++) {
      leb(styles, 1);
      styles.write(split ? i % 8 : 1);
    }
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("schemaVersion", version);
    m.put("textEncoding", "utf-8");
    m.put("internalEol", "LF");
    m.put("preferredExportEol", "LF");
    m.put("exportBom", false);
    m.put("offsetUnit", "utf16");
    m.put("utf8Bytes", raw.length);
    m.put("utf16Length", text.length());
    m.put("logicalLines", text.chars().filter(c -> c == '\n').count() + 1);
    m.put("stylesEncoding", "adaptive-v1");
    m.put("textSha256", NativeCodec.sha256(raw));
    m.put("stylesSha256", NativeCodec.sha256(styles.toByteArray()));
    if (formatting != null) {
      m.put(
          "formattingEncoding",
          version == 5 ? "sparse-v3" : version == 4 ? "sparse-v2" : "sparse-v1");
      m.put("formattingSha256", NativeCodec.sha256(formatting.getBytes(StandardCharsets.UTF_8)));
    }
    if (media != null) {
      m.put("mediaEncoding", "embedded-v1");
      m.put("mediaSha256", NativeCodec.sha256(media.getBytes(StandardCharsets.UTF_8)));
    }
    Path path = temp.resolve(UUID.randomUUID() + ".tedoc");
    Map<String, byte[]> entries = new LinkedHashMap<>();
    entries.put("manifest.json", new ObjectMapper().writeValueAsBytes(m));
    entries.put("text.utf8", raw);
    entries.put("styles.bin", styles.toByteArray());
    if (formatting != null)
      entries.put("formatting.json", formatting.getBytes(StandardCharsets.UTF_8));
    if (media != null) entries.put("media.json", media.getBytes(StandardCharsets.UTF_8));
    try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(path))) {
      for (var e : entries.entrySet()) {
        ZipEntry entry = new ZipEntry(e.getKey());
        entry.setMethod(ZipEntry.STORED);
        entry.setSize(e.getValue().length);
        CRC32 crc = new CRC32();
        crc.update(e.getValue());
        entry.setCrc(crc.getValue());
        zip.putNextEntry(entry);
        zip.write(e.getValue());
        zip.closeEntry();
      }
    }
    return path;
  }

  @Test
  void localStorageImmutableBoundedAndGenerationPinned() throws Exception {
    LocalStorage storage = new LocalStorage(temp, "http://localhost:8080");
    String key = "snapshots/abc/test.tedoc";
    storage.writeNew(key, new ByteArrayInputStream(new byte[] {1, 2}), 2, 10);
    assertThrows(
        FileAlreadyExistsException.class,
        () -> storage.writeNew(key, new ByteArrayInputStream(new byte[] {3, 4}), 2, 10));
    assertArrayEquals(
        new byte[] {1, 2},
        storage.read(new StorageProvider.ObjectRef("LOCAL", null, key, "1")).readAllBytes());
    assertThrows(
        IOException.class,
        () ->
            storage.writeNew("snapshots/../secret", new ByteArrayInputStream(new byte[0]), 0, 10));
    assertThrows(
        IOException.class,
        () -> storage.read(new StorageProvider.ObjectRef("LOCAL", null, key, "2")));
    assertThrows(
        IOException.class,
        () ->
            storage.writeNew(
                "snapshots/abc/bad.tedoc", new ByteArrayInputStream(new byte[] {1}), 2, 10));
    assertThrows(NoSuchFileException.class, () -> storage.inspect("snapshots/abc/bad.tedoc"));
  }

  @Test
  void eventSchemasRejectUnknownAndPrivatePayload() throws Exception {
    String example =
        Files.readString(
            Path.of("../../docs/contracts/events/document.version.saved.v1.example.json"));
    assertTrue(EventSchemas.valid("document.version.saved.v1", example));
    assertFalse(
        EventSchemas.valid(
            "document.version.saved.v1",
            example.replace(
                "\"nativeBytes\": 1024", "\"nativeBytes\": 1024, \"accessToken\": \"secret\"")));
    assertFalse(
        EventSchemas.valid(
            "document.version.saved.v1", example.replace("\"revision\": 1", "\"revision\": 0")));
  }

  @Test
  void crashPartialsExpireWithoutTouchingImmutableObjects() throws Exception {
    LocalStorage storage = new LocalStorage(temp, "http://localhost:8080");
    String key = "snapshots/abc/committed.tedoc";
    storage.writeNew(key, new ByteArrayInputStream(new byte[] {1}), 1, 10);
    Path stale = temp.resolve("snapshots/abc/crashed.partial"),
        recent = temp.resolve("snapshots/abc/inflight.partial");
    Files.write(stale, new byte[] {2});
    Files.write(recent, new byte[] {3});
    Files.setLastModifiedTime(
        stale, java.nio.file.attribute.FileTime.from(java.time.Instant.now().minusSeconds(7200)));
    storage.cleanIncompleteBefore(java.time.Instant.now().minusSeconds(3600));
    assertFalse(Files.exists(stale));
    assertTrue(Files.exists(recent));
    assertNotNull(storage.inspect(key));
  }
}
