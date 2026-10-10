package vn.editor.collaboration.rooms.application.query;

import java.util.UUID;
import vn.editor.collaboration.rooms.application.port.RoomRepository;

public interface RoomQueryService {
  RoomRepository.Page read(UUID id, long after, String bearer);
}
