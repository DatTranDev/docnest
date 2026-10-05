package vn.editor.common.storage;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.cloud.ReadChannel;
import com.google.cloud.WriteChannel;
import com.google.cloud.storage.Blob;
import com.google.cloud.storage.BlobId;
import com.google.cloud.storage.BlobInfo;
import com.google.cloud.storage.Storage;
import com.google.cloud.storage.StorageException;
import com.google.cloud.storage.StorageOptions;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.channels.Channels;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import vn.editor.common.codec.NativeCodec;

/**
 * Private objects; browser resumable capabilities are issued create-only; downloads use
 * authenticated service proxy.
 */
public final class GcsStorage implements StorageProvider {
  private final Storage storage;
  private final String bucket, origin, uploadBase;
  private final GoogleCredentials credentials;

  public GcsStorage(String bucket, String origin) throws IOException {
    this(
        StorageOptions.getDefaultInstance().getService(),
        GoogleCredentials.getApplicationDefault()
            .createScoped("https://www.googleapis.com/auth/devstorage.read_write"),
        bucket,
        origin);
  }

  public GcsStorage(Storage storage, GoogleCredentials credentials, String bucket, String origin) {
    this(storage, credentials, bucket, origin, "https://storage.googleapis.com");
  }

  GcsStorage(
      Storage storage,
      GoogleCredentials credentials,
      String bucket,
      String origin,
      String uploadBase) {
    this.storage = storage;
    this.credentials = credentials;
    this.bucket = bucket;
    this.origin = origin;
    this.uploadBase = uploadBase;
  }

  public String provider() {
    return "GCS";
  }

  public String bucket() {
    return bucket;
  }

  private void key(String key) throws IOException {
    if (key == null || !key.matches("(?:snapshots|results)/[a-zA-Z0-9._/-]+") || key.contains(".."))
      throw new IOException("INVALID_OBJECT_KEY");
  }

  public Upload createUpload(String key, long bytes, String id) throws IOException {
    key(key);
    credentials.refreshIfExpired();
    String q = URLEncoder.encode(key, StandardCharsets.UTF_8);
    HttpRequest request =
        HttpRequest.newBuilder(
                URI.create(
                    uploadBase
                        + "/upload/storage/v1/b/"
                        + bucket
                        + "/o?uploadType=resumable&ifGenerationMatch=0&name="
                        + q))
            .timeout(Duration.ofSeconds(10))
            .header("Authorization", "Bearer " + credentials.getAccessToken().getTokenValue())
            .header("Content-Type", "application/json; charset=UTF-8")
            .header("X-Upload-Content-Type", "application/octet-stream")
            .header("X-Upload-Content-Length", Long.toString(bytes))
            .header("Origin", origin)
            .POST(HttpRequest.BodyPublishers.ofString("{}"))
            .build();
    HttpResponse<Void> response = send(request);
    String location = response.headers().firstValue("Location").orElse(null);
    if (response.statusCode() != 200 || location == null || !location.startsWith(uploadBase + "/"))
      throw new IOException("STORAGE_UNAVAILABLE");
    return new Upload(
        "GCS_RESUMABLE", location, Map.of("Content-Type", "application/octet-stream"));
  }

  public Metadata inspect(String key) throws IOException {
    key(key);
    try {
      Blob b = storage.get(BlobId.of(bucket, key));
      if (b == null) throw new FileNotFoundException("OBJECT_NOT_FOUND");
      ObjectRef ref = new ObjectRef("GCS", bucket, key, b.getGeneration().toString());
      try (InputStream in = read(ref)) {
        return new Metadata(ref, b.getSize(), NativeCodec.sha256(in));
      }
    } catch (StorageException ex) {
      throw new IOException("STORAGE_UNAVAILABLE", ex);
    }
  }

  public InputStream read(ObjectRef r) throws IOException {
    key(r.key());
    if (!r.provider().equals("GCS") || !bucket.equals(r.bucket()))
      throw new IOException("INVALID_OBJECT_REF");
    try {
      ReadChannel channel =
          storage.reader(
              BlobId.of(bucket, r.key(), Long.parseLong(r.generation())),
              Storage.BlobSourceOption.generationMatch());
      return Channels.newInputStream(channel);
    } catch (StorageException ex) {
      throw new IOException("STORAGE_UNAVAILABLE", ex);
    }
  }

  public Metadata writeNew(String key, InputStream input, long expected, long cap)
      throws IOException {
    key(key);
    try (WriteChannel writer =
        storage.writer(
            BlobInfo.newBuilder(bucket, key).setContentType("application/octet-stream").build(),
            Storage.BlobWriteOption.doesNotExist())) {
      byte[] b = new byte[65536];
      long n = 0;
      for (int read; (read = input.read(b)) != -1; ) {
        n += read;
        if (n > cap || n > expected) throw new IOException("FILE_TOO_LARGE");
        ByteBuffer buffer = ByteBuffer.wrap(b, 0, read);
        while (buffer.hasRemaining()) writer.write(buffer);
      }
      if (n != expected) throw new IOException("UPLOAD_SIZE_MISMATCH");
    } catch (StorageException ex) {
      throw new IOException("STORAGE_UNAVAILABLE", ex);
    }
    return inspect(key);
  }

  public void deleteGeneration(ObjectRef r) throws IOException {
    key(r.key());
    if (!bucket.equals(r.bucket()) || !r.provider().equals("GCS"))
      throw new IOException("INVALID_OBJECT_REF");
    try {
      storage.delete(
          BlobId.of(bucket, r.key(), Long.parseLong(r.generation())),
          Storage.BlobSourceOption.generationMatch());
    } catch (StorageException ex) {
      if (ex.getCode() != 404) throw new IOException("STORAGE_UNAVAILABLE", ex);
    }
  }

  public void cancelUpload(String session) throws IOException {
    if (session == null) return;
    if (!session.startsWith(uploadBase + "/")) throw new IOException("INVALID_SESSION");
    int status =
        send(HttpRequest.newBuilder(URI.create(session))
                .timeout(Duration.ofSeconds(10))
                .DELETE()
                .build())
            .statusCode();
    if (status != 499 && status != 204 && status != 404 && status != 410)
      throw new IOException("STORAGE_UNAVAILABLE");
  }

  private HttpResponse<Void> send(HttpRequest request) throws IOException {
    try {
      return HttpClient.newBuilder()
          .connectTimeout(Duration.ofSeconds(10))
          .followRedirects(HttpClient.Redirect.NEVER)
          .build()
          .send(request, HttpResponse.BodyHandlers.discarding());
    } catch (InterruptedException ex) {
      Thread.currentThread().interrupt();
      throw new IOException("STORAGE_UNAVAILABLE", ex);
    }
  }
}
