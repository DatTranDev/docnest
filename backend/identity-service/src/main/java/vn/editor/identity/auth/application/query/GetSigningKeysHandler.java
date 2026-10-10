package vn.editor.identity.auth.application.query;

import java.util.Map;
import vn.editor.identity.auth.application.port.AccessTokens;

public final class GetSigningKeysHandler implements GetSigningKeysService {
  private final AccessTokens tokens;

  public GetSigningKeysHandler(AccessTokens tokens) {
    this.tokens = tokens;
  }

  public Map<String, Object> handle() {
    return tokens.publicKeys();
  }
}
