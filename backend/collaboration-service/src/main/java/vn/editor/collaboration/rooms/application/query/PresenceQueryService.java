package vn.editor.collaboration.rooms.application.query;

import java.util.List;
import java.util.UUID;
import vn.editor.collaboration.rooms.application.port.PresenceRepository;

public interface PresenceQueryService {
  List<PresenceRepository.Member> list(UUID documentId, String bearer);
}
