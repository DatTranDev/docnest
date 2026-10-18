package vn.editor.collaboration.rooms.application.port;

import java.util.List;
import java.util.UUID;

public interface PresenceRepository {
  record Member(UUID userId, UUID sessionId, Integer anchor, Integer head) {}

  void heartbeat(UUID documentId, UUID sessionId, UUID userId, Integer anchor, Integer head);

  List<Member> list(UUID documentId);

  void leave(UUID documentId, UUID sessionId, UUID userId);
}
