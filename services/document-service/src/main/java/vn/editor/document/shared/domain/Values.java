package vn.editor.document.shared.domain;

import java.text.Normalizer;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

public final class Values {
  public static final long MAX_SAFE_INTEGER = 9007199254740991L;

  private Values() {}

  public static String id(Object value) {
    if (!(value instanceof String id)
        || !id.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"))
      throw new DomainException(400, "INVALID_REQUEST");
    return id;
  }

  public static String nullableId(Object value) {
    return value == null ? null : id(value);
  }

  public static long integer(Object value, long min, long max) {
    if (!(value instanceof Number n)
        || n.doubleValue() != n.longValue()
        || n.longValue() < min
        || n.longValue() > max) throw new DomainException(400, "INVALID_REQUEST");
    return n.longValue();
  }

  public static String name(Object value, int max) {
    if (!(value instanceof String name) || name.isBlank())
      throw new DomainException(400, "INVALID_REQUEST");
    name = Normalizer.normalize(name, Normalizer.Form.NFC);
    if (name.codePointCount(0, name.length()) > max
        || name.codePoints().anyMatch(Character::isISOControl))
      throw new DomainException(400, "INVALID_REQUEST");
    return name;
  }

  public static void fields(Map<String, Object> body, String required, String optional) {
    Set<String> must = new HashSet<>(Arrays.asList(required.split(",")));
    must.remove("");
    Set<String> allowed = new HashSet<>(must);
    allowed.addAll(Arrays.asList(optional.split(",")));
    if (!body.keySet().containsAll(must) || !allowed.containsAll(body.keySet()))
      throw new DomainException(400, "INVALID_REQUEST");
  }

  public static Map<String, Object> map(Object... entries) {
    Map<String, Object> result = new LinkedHashMap<>();
    for (int i = 0; i < entries.length; i += 2) result.put((String) entries[i], entries[i + 1]);
    return result;
  }

  public static void quota(long count, long maximum) {
    if (count >= maximum) throw new DomainException(429, "QUOTA_EXCEEDED");
  }

  public static void metadataRevision(long actual, Object expected) {
    if (actual != integer(expected, 1, MAX_SAFE_INTEGER))
      throw new DomainException(409, "METADATA_CONFLICT", map("currentMetadataRevision", actual));
  }
}
