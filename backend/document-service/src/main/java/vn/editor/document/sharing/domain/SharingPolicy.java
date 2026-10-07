package vn.editor.document.sharing.domain;

import java.util.Set;
import vn.editor.document.shared.domain.DomainException;
import vn.editor.document.shared.domain.Values;

public final class SharingPolicy {
  private SharingPolicy() {}

  public static String role(String role) {
    if (role == null || !Set.of("VIEWER", "EDITOR").contains(role))
      throw new DomainException(400, "INVALID_REQUEST");
    return role;
  }

  public static void grantee(String actor, String owner, String grantee) {
    Values.id(grantee);
    if (grantee.equals(actor) || grantee.equals(owner))
      throw new DomainException(422, "INVALID_GRANTEE");
  }

  public static long lifetime(Object seconds) {
    return seconds == null ? 604800 : Values.integer(seconds, 3600, 2592000);
  }

  public static String publicToken(String token) {
    if (token == null || !token.matches("[A-Za-z0-9_-]{43}"))
      throw new DomainException(404, "DOCUMENT_NOT_FOUND");
    return token;
  }
}
