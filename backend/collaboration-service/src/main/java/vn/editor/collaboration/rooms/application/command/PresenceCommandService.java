package vn.editor.collaboration.rooms.application.command;

import java.util.UUID;

public interface PresenceCommandService {
  void heartbeat(
      UUID documentId, UUID sessionId, UUID userId, Integer anchor, Integer head, String bearer);

  void leave(UUID documentId, UUID sessionId, UUID userId);
}
