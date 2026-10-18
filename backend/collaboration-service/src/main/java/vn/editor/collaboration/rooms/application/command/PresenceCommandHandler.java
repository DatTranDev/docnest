package vn.editor.collaboration.rooms.application.command;

import java.util.UUID;
import vn.editor.collaboration.rooms.application.port.DocumentAccess;
import vn.editor.collaboration.rooms.application.port.PresenceRepository;
import vn.editor.collaboration.rooms.domain.RoomFailure;

public final class PresenceCommandHandler implements PresenceCommandService {
  private final PresenceRepository presence;
  private final DocumentAccess documents;

  public PresenceCommandHandler(PresenceRepository presence, DocumentAccess documents) {
    this.presence = presence;
    this.documents = documents;
  }

  @Override
  public void heartbeat(
      UUID documentId, UUID sessionId, UUID userId, Integer anchor, Integer head, String bearer) {
    if ((anchor != null && (anchor < 0 || anchor > 200_000))
        || (head != null && (head < 0 || head > 200_000)))
      throw new RoomFailure("COLLABORATION_INVALID_CURSOR");
    documents.check(documentId, bearer);
    presence.heartbeat(documentId, sessionId, userId, anchor, head);
  }

  @Override
  public void leave(UUID documentId, UUID sessionId, UUID userId) {
    presence.leave(documentId, sessionId, userId);
  }
}
