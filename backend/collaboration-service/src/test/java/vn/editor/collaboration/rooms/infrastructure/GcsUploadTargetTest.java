package vn.editor.collaboration.rooms.infrastructure;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import org.junit.jupiter.api.Test;
import vn.editor.collaboration.rooms.domain.RoomFailure;

class GcsUploadTargetTest {
  @Test
  void acceptsOnlyTheConfiguredBucketAndGoogleResumableEndpoint() {
    String valid =
        "https://storage.googleapis.com/upload/storage/v1/b/lab-snapshots/o?uploadType=resumable&upload_id=opaque";
    assertEquals("storage.googleapis.com", GcsUploadTarget.parse(valid, "lab-snapshots").getHost());
    for (String invalid :
        List.of(
            valid.replace("https:", "http:"),
            valid.replace("storage.googleapis.com", "127.0.0.1"),
            valid.replace("storage.googleapis.com", "storage.googleapis.com.evil.test"),
            valid.replace("storage.googleapis.com", "credentials@storage.googleapis.com"),
            valid.replace("storage.googleapis.com", "storage.googleapis.com:8443"),
            valid.replace("lab-snapshots", "different-bucket"),
            valid.replace("/o?", "/%2e%2e/o?"),
            valid.replace("upload_id=opaque", "other=opaque"),
            valid + "#fragment")) {
      RoomFailure failure =
          assertThrows(RoomFailure.class, () -> GcsUploadTarget.parse(invalid, "lab-snapshots"));
      assertEquals("COLLABORATION_STORAGE_UNAVAILABLE", failure.getMessage());
    }
    assertThrows(RoomFailure.class, () -> GcsUploadTarget.parse(valid, ""));
  }
}
