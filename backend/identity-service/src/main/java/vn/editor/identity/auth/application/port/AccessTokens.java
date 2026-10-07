package vn.editor.identity.auth.application.port;

import java.util.Map;

public interface AccessTokens {
  String issue(String userId);

  Map<String, Object> publicKeys();
}
