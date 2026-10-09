package vn.editor.collaboration.rooms.application.port;

import java.util.List;
import java.util.UUID;

public interface RoomStore {
  record Update(long sequence, UUID operationId, byte[] payload) {}

  record Page(long headRevision, long sequence, List<Update> updates) {}

  Page join(UUID documentId, long headRevision, byte[] seed);

  Page read(UUID documentId, long after);

  long append(UUID documentId, UUID operationId, UUID userId, byte[] payload);

  long reserveCheckpoint(UUID documentId, long sequence, UUID lease);

  void finishCheckpoint(UUID documentId, UUID lease, long revision);

  void releaseCheckpoint(UUID documentId, UUID lease);
}
