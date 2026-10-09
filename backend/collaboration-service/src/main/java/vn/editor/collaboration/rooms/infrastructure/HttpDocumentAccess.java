package vn.editor.collaboration.rooms.infrastructure;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import vn.editor.collaboration.rooms.application.port.DocumentAccess;
import vn.editor.collaboration.rooms.domain.RoomFailure;

@Component
public class HttpDocumentAccess implements DocumentAccess {
  private final HttpClient client =
      HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
  private final JsonMapper json = JsonMapper.builder().build();
  private final String origin;
  private final String snapshotsBucket;

  public HttpDocumentAccess(
      @Value("${editor.document-url}") String origin,
      @Value("${editor.snapshots-bucket:}") String snapshotsBucket) {
    this.origin = origin;
    this.snapshotsBucket = snapshotsBucket;
  }

  @Override
  public Access check(UUID documentId, String bearer) {
    try {
      var request =
          HttpRequest.newBuilder(URI.create(origin + "/api/v1/documents/" + documentId))
              .timeout(Duration.ofSeconds(5))
              .header("Authorization", "Bearer " + bearer)
              .GET()
              .build();
      var response = client.send(request, HttpResponse.BodyHandlers.ofInputStream());
      try (var body = response.body()) {
        if (response.statusCode() == 401) throw new RoomFailure("COLLABORATION_UNAUTHENTICATED");
        if (response.statusCode() == 403 || response.statusCode() == 404)
          throw new RoomFailure("COLLABORATION_NOT_FOUND");
        if (response.statusCode() != 200) throw new RoomFailure("COLLABORATION_ACCESS_UNAVAILABLE");
        byte[] bytes = body.readNBytes(65537);
        if (bytes.length > 65536) throw new RoomFailure("COLLABORATION_ACCESS_UNAVAILABLE");
        JsonNode data = json.readTree(bytes);
        if (!data.path("deletedAt").isNull() && !data.path("deletedAt").isMissingNode())
          throw new RoomFailure("COLLABORATION_NOT_FOUND");
        String role = data.path("effectiveRole").asString();
        if (!data.path("headRevision").isIntegralNumber())
          throw new RoomFailure("COLLABORATION_ACCESS_UNAVAILABLE");
        return new Access(
            data.path("headRevision").asLong(), role.equals("OWNER") || role.equals("EDITOR"));
      }
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
      throw new RoomFailure("COLLABORATION_ACCESS_UNAVAILABLE");
    } catch (java.io.IOException error) {
      throw new RoomFailure("COLLABORATION_ACCESS_UNAVAILABLE");
    }
  }

  @Override
  public long save(UUID id, long head, byte[] nativeFile, UUID key, String bearer) {
    try {
      String hash =
          HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(nativeFile));
      JsonNode ticket =
          post(
              "/api/v1/documents/" + id + "/uploads",
              Map.of(
                  "expectedHeadRevision",
                  head,
                  "nativeBytes",
                  nativeFile.length,
                  "nativeSha256",
                  hash),
              bearer,
              null);
      UUID uploadId = UUID.fromString(ticket.path("uploadId").asString());
      String kind = ticket.path("kind").asString();
      HttpRequest.Builder upload;
      if (kind.equals("LOCAL")) {
        upload =
            HttpRequest.newBuilder(URI.create(origin + "/api/v1/uploads/" + uploadId + "/content"))
                .header("Authorization", "Bearer " + bearer);
      } else if (kind.equals("GCS_RESUMABLE")) {
        // Google receives only its bounded resumable capability, never the user's JWT.
        upload =
            HttpRequest.newBuilder(
                GcsUploadTarget.parse(ticket.path("uploadUrl").asString(), snapshotsBucket));
      } else {
        throw new RoomFailure("COLLABORATION_STORAGE_UNAVAILABLE");
      }
      upload.timeout(Duration.ofSeconds(30));
      // BodyPublisher supplies the exact Content-Length. HttpClient deliberately
      // forbids setting that header manually; no other ticket header is needed locally.
      upload.header("Content-Type", "application/octet-stream");
      var response =
          client.send(
              upload.PUT(HttpRequest.BodyPublishers.ofByteArray(nativeFile)).build(),
              HttpResponse.BodyHandlers.discarding());
      if (response.statusCode() / 100 != 2) throw new RoomFailure("COLLABORATION_SAVE_FAILED");
      for (int attempt = 0; attempt < 3; attempt++) {
        try {
          JsonNode result =
              post(
                  "/api/v1/documents/" + id + "/versions",
                  Map.of("expectedHeadRevision", head, "uploadId", uploadId.toString()),
                  bearer,
                  key);
          return result.path("version").path("revision").asLong();
        } catch (java.io.IOException error) {
          if (attempt == 2) throw error;
        }
      }
      throw new RoomFailure("COLLABORATION_SAVE_FAILED");
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
      throw new RoomFailure("COLLABORATION_SAVE_FAILED");
    } catch (java.io.IOException | java.security.NoSuchAlgorithmException error) {
      throw new RoomFailure("COLLABORATION_SAVE_FAILED");
    }
  }

  private JsonNode post(String path, Map<String, Object> body, String bearer, UUID key)
      throws java.io.IOException, InterruptedException {
    var request =
        HttpRequest.newBuilder(URI.create(origin + path))
            .timeout(Duration.ofSeconds(20))
            .header("Authorization", "Bearer " + bearer)
            .header("Content-Type", "application/json");
    if (key != null) request.header("Idempotency-Key", key.toString());
    var response =
        client.send(
            request
                .POST(HttpRequest.BodyPublishers.ofByteArray(json.writeValueAsBytes(body)))
                .build(),
            HttpResponse.BodyHandlers.ofInputStream());
    try (var content = response.body()) {
      if (response.statusCode() == 409) throw new RoomFailure("COLLABORATION_HEAD_CHANGED");
      if (response.statusCode() == 403 || response.statusCode() == 404)
        throw new RoomFailure("COLLABORATION_NOT_FOUND");
      if (response.statusCode() / 100 != 2) throw new RoomFailure("COLLABORATION_SAVE_FAILED");
      byte[] bytes = content.readNBytes(65537);
      if (bytes.length > 65536) throw new RoomFailure("COLLABORATION_SAVE_FAILED");
      return json.readTree(bytes);
    }
  }
}
