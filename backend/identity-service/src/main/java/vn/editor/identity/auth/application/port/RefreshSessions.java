package vn.editor.identity.auth.application.port;

import vn.editor.identity.auth.domain.RefreshSession;

public interface RefreshSessions {
  String findUserId(String fingerprint);

  RefreshSession lockByFingerprint(String fingerprint);

  void insert(RefreshSession session);

  void markUsed(String sessionId);

  void revokeFamily(String familyId);
}
