package vn.editor.collaboration.rooms.infrastructure;

import java.net.URI;
import vn.editor.collaboration.rooms.domain.RoomFailure;

/** Bound the private resumable capability supplied by Document; never log it. */
final class GcsUploadTarget {
  static URI parse(String value, String bucket) {
    try {
      URI uri = URI.create(value);
      if (bucket == null
          || !bucket.matches("[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]")
          || !"https".equals(uri.getScheme())
          || !"storage.googleapis.com".equals(uri.getHost())
          || uri.getUserInfo() != null
          || uri.getFragment() != null
          || (uri.getPort() != -1 && uri.getPort() != 443)
          || !("/upload/storage/v1/b/" + bucket + "/o").equals(uri.getRawPath())
          || uri.getRawQuery() == null
          || !uri.getRawQuery().matches("(?:[^&]*&)*upload_id=[^&]+(?:&.*)?")) {
        throw new RoomFailure("COLLABORATION_STORAGE_UNAVAILABLE");
      }
      return uri;
    } catch (IllegalArgumentException error) {
      throw new RoomFailure("COLLABORATION_STORAGE_UNAVAILABLE");
    }
  }

  private GcsUploadTarget() {}
}
