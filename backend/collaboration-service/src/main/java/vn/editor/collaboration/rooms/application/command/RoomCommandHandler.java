package vn.editor.collaboration.rooms.application.command;

import java.util.UUID;
import vn.editor.collaboration.rooms.application.port.DocumentAccess;
import vn.editor.collaboration.rooms.application.port.RoomRepository;
import vn.editor.collaboration.rooms.domain.RoomFailure;
import vn.editor.collaboration.rooms.domain.RoomPolicy;

public final class RoomCommandHandler implements RoomCommandService {
  private final RoomRepository rooms;
  private final DocumentAccess documents;

  public RoomCommandHandler(RoomRepository rooms, DocumentAccess documents) {
    this.rooms = rooms;
    this.documents = documents;
  }

  public RoomRepository.Page join(UUID id, long revision, byte[] seed, String bearer) {
    RoomPolicy.update(seed);
    var access = documents.check(id, bearer);
    if (!access.writable()) throw new RoomFailure("COLLABORATION_READ_ONLY");
    if (access.headRevision() != revision) throw new RoomFailure("COLLABORATION_HEAD_CHANGED");
    var room = rooms.join(id, revision, seed);
    if (room.headRevision() != revision) throw new RoomFailure("COLLABORATION_HEAD_CHANGED");
    return room;
  }

  public long append(UUID id, UUID operationId, UUID userId, byte[] payload, String bearer) {
    RoomPolicy.update(payload);
    var access = documents.check(id, bearer);
    if (!access.writable()) throw new RoomFailure("COLLABORATION_READ_ONLY");
    return rooms.append(id, operationId, userId, payload);
  }

  public long checkpoint(UUID id, long sequence, byte[] nativeFile, String bearer) {
    if (nativeFile.length == 0 || nativeFile.length > 32 * 1024 * 1024)
      throw new RoomFailure("COLLABORATION_UPDATE_LIMIT");
    var access = documents.check(id, bearer);
    if (!access.writable()) throw new RoomFailure("COLLABORATION_READ_ONLY");
    UUID lease = UUID.randomUUID();
    long head = rooms.reserveCheckpoint(id, sequence, lease);
    try {
      if (head != documents.check(id, bearer).headRevision())
        throw new RoomFailure("COLLABORATION_HEAD_CHANGED");
      long revision = documents.save(id, head, nativeFile, lease, bearer);
      rooms.finishCheckpoint(id, lease, revision);
      return revision;
    } finally {
      rooms.releaseCheckpoint(id, lease);
    }
  }
}
