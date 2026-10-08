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
    m.put("schemaVersion", 1);
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
    Path path = temp.resolve(UUID.randomUUID() + ".tedoc");
    try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(path))) {
      for (var e :
          Map.of(
                  "manifest.json",
                  new ObjectMapper().writeValueAsBytes(m),
                  "text.utf8",
                  raw,
                  "styles.bin",
                  styles.toByteArray())
              .entrySet()) {
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
