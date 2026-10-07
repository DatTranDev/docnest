package vn.editor.common.storage;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Map;
import java.util.UUID;
import vn.editor.common.codec.NativeCodec;

public final class LocalStorage implements StorageProvider {
  private final Path root;
  private final String baseUrl;

  public LocalStorage(Path root, String baseUrl) throws IOException {
    this.root = root.toAbsolutePath().normalize();
    this.baseUrl = baseUrl;
    Files.createDirectories(this.root);
  }

  private Path path(String key) throws IOException {
    if (key == null || !key.matches("(?:snapshots|results)/[a-zA-Z0-9._/-]+") || key.contains(".."))
      throw new IOException("INVALID_OBJECT_KEY");
    Path p = root.resolve(key).normalize();
    if (!p.startsWith(root)) throw new IOException("INVALID_OBJECT_KEY");
    for (Path current = p.getParent();
        current != null && current.startsWith(root);
        current = current.getParent())
      if (Files.isSymbolicLink(current)) throw new IOException("INVALID_OBJECT_KEY");
    return p;
  }

  public String provider() {
    return "LOCAL";
  }

  public String bucket() {
    return null;
  }

  public Upload createUpload(String key, long bytes, String id) {
    return new Upload(
        "LOCAL",
        baseUrl + "/api/v1/uploads/" + id + "/content",
        Map.of("Content-Type", "application/octet-stream", "Content-Length", Long.toString(bytes)));
  }

  public Metadata inspect(String key) throws IOException {
    Path p = path(key);
    if (Files.isSymbolicLink(p)) throw new IOException("INVALID_OBJECT_KEY");
    try (InputStream in = Files.newInputStream(p)) {
      return new Metadata(
          new ObjectRef("LOCAL", null, key, "1"), Files.size(p), NativeCodec.sha256(in));
    }
  }

  public InputStream read(ObjectRef r) throws IOException {
    if (!r.provider().equals("LOCAL") || !"1".equals(r.generation()) || r.bucket() != null)
      throw new IOException("GENERATION_MISMATCH");
    Path p = path(r.key());
    if (Files.isSymbolicLink(p)) throw new IOException("INVALID_OBJECT_KEY");
    return Files.newInputStream(p, LinkOption.NOFOLLOW_LINKS);
  }

  public Metadata writeNew(String key, InputStream input, long expected, long cap)
      throws IOException {
    Path target = path(key);
    Files.createDirectories(target.getParent());
    Path temporary =
        target.resolveSibling(target.getFileName() + "." + UUID.randomUUID() + ".partial");
    long count = 0;
    try {
      try (OutputStream out = Files.newOutputStream(temporary, StandardOpenOption.CREATE_NEW)) {
        byte[] b = new byte[65536];
        for (int n; (n = input.read(b)) != -1; ) {
          count += n;
          if (count > cap || count > expected) throw new IOException("FILE_TOO_LARGE");
          out.write(b, 0, n);
        }
      }
      if (count != expected) throw new IOException("UPLOAD_SIZE_MISMATCH");
      try {
        Files.createLink(target, temporary);
      } catch (UnsupportedOperationException ex) {
        Files.move(temporary, target);
      }
      return inspect(key);
    } finally {
      Files.deleteIfExists(temporary);
    }
  }

  public void deleteGeneration(ObjectRef r) throws IOException {
    if (!"1".equals(r.generation()) || !r.provider().equals("LOCAL"))
      throw new IOException("GENERATION_MISMATCH");
    Files.deleteIfExists(path(r.key()));
  }

  public void cleanIncompleteBefore(java.time.Instant cutoff) throws IOException {
    try (var paths = Files.walk(root, 4)) {
      for (Path candidate :
          paths
              .filter(
                  p -> p.getFileName().toString().endsWith(".partial") && !Files.isSymbolicLink(p))
              .toList()) {
        if (Files.isRegularFile(candidate, LinkOption.NOFOLLOW_LINKS)
            && Files.getLastModifiedTime(candidate, LinkOption.NOFOLLOW_LINKS)
                .toInstant()
                .isBefore(cutoff)) Files.deleteIfExists(candidate);
      }
    }
  }
}
