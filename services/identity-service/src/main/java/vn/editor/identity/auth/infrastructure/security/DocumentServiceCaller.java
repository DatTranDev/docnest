package vn.editor.identity.auth.infrastructure.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import vn.editor.identity.auth.application.port.ServiceCaller;
import vn.editor.identity.auth.domain.AuthenticationFailure;

public final class DocumentServiceCaller implements ServiceCaller {
  private final String documentKey;

  public DocumentServiceCaller(String documentKey) {
    this.documentKey = documentKey;
  }

  @Override
  public void requireDocument(String key) {
    if (documentKey.isBlank()
        || key == null
        || !MessageDigest.isEqual(
            documentKey.getBytes(StandardCharsets.UTF_8), key.getBytes(StandardCharsets.UTF_8)))
      throw new AuthenticationFailure(
          AuthenticationFailure.Reason.INVALID_SERVICE_CALLER, "Caller is not authorized");
  }
}
