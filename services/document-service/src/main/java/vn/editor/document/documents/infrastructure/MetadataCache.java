package vn.editor.document.documents.infrastructure;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import vn.editor.document.documents.application.port.MetadataProjection;
import vn.editor.document.documents.application.query.DocumentView;

/** Only a projection: SQL ACL and revision checks always precede this optional cache. */
@Component
public class MetadataCache implements MetadataProjection {
  @Override
  public DocumentView afterAuthorization(DocumentView live) {
    Map<String, Object> values = json.convertValue(live, Map.class);
    return json.convertValue(cachedProjection(values), DocumentView.class);
  }

  final StringRedisTemplate redis;
  final ObjectMapper json = new ObjectMapper();

  public MetadataCache(StringRedisTemplate redis) {
    this.redis = redis;
  }

  private Map<String, Object> cachedProjection(Map<String, Object> live) {
    if (org.springframework.transaction.support.TransactionSynchronizationManager
        .isActualTransactionActive()) return live;
    String key =
        "docmeta:"
            + live.get("id")
            + ":"
            + live.get("metadataRevision")
            + ":"
            + live.get("headRevision");
    try {
      String value = redis.opsForValue().get(key);
      if (value != null) {
        Map<String, Object> cached = json.readValue(value, Map.class);
        cached.put("effectiveRole", live.get("effectiveRole"));
        cached.put("folderId", live.get("folderId"));
        cached.put("preview", live.get("preview"));
        return cached;
      }
      Map<String, Object> projection = new LinkedHashMap<>(live);
      projection.remove("effectiveRole");
      projection.remove("folderId");
      projection.remove("preview");
      redis.opsForValue().set(key, json.writeValueAsString(projection), Duration.ofSeconds(60));
    } catch (Exception ex) {
      /* Correctness falls back to authorized SQL state. */
    }
    return live;
  }
}
