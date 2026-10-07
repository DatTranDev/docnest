package vn.editor.document.shared.infrastructure;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;
import vn.editor.document.shared.domain.DomainException;

public final class Cursors {
  private final ObjectMapper json = new ObjectMapper();

  public Map<String, Object> decode(String value) {
    if (value == null) return null;
    try {
      if (value.length() > 2048) throw new IllegalArgumentException();
      return json.readValue(Base64.getUrlDecoder().decode(value), Map.class);
    } catch (Exception ex) {
      throw new DomainException(400, "INVALID_CURSOR");
    }
  }

  public String encode(Map<String, Object> value) {
    try {
      return Base64.getUrlEncoder()
          .withoutPadding()
          .encodeToString(json.writeValueAsString(value).getBytes(StandardCharsets.UTF_8));
    } catch (IOException ex) {
      throw new IllegalStateException(ex);
    }
  }
}
