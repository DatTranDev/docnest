package vn.editor.collaboration.rooms.application.query;

import java.util.List;
import java.util.UUID;
import vn.editor.collaboration.rooms.application.port.DocumentAccess;
import vn.editor.collaboration.rooms.application.port.PresenceRepository;

public final class PresenceQueryHandler implements PresenceQueryService {
  private final PresenceRepository presence;
  private final DocumentAccess documents;

  public PresenceQueryHandler(PresenceRepository presence, DocumentAccess documents) {
    this.presence = presence;
    this.documents = documents;
  }

  @Override
  public List<PresenceRepository.Member> list(UUID documentId, String bearer) {
    documents.check(documentId, bearer);
    return presence.list(documentId);
  }
}
