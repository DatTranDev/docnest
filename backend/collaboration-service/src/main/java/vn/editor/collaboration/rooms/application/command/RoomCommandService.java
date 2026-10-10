package vn.editor.collaboration.rooms.application.command;

import java.util.UUID;
import vn.editor.collaboration.rooms.application.port.RoomRepository;

public interface RoomCommandService {
  RoomRepository.Page join(UUID id, long revision, byte[] seed, String bearer);

  long append(UUID id, UUID operationId, UUID userId, byte[] payload, String bearer);

  long checkpoint(UUID id, long sequence, byte[] nativeFile, String bearer);
}
