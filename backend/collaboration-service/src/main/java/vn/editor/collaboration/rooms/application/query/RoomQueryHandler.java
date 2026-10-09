package vn.editor.collaboration.rooms.application.query;

import java.util.UUID;
import vn.editor.collaboration.rooms.application.port.DocumentAccess;
import vn.editor.collaboration.rooms.application.port.RoomStore;
import vn.editor.collaboration.rooms.domain.RoomFailure;

public final class RoomQueryHandler {
  private final RoomStore rooms;
  private final DocumentAccess documents;

  public RoomQueryHandler(RoomStore rooms, DocumentAccess documents) {
    this.rooms = rooms;
    this.documents = documents;
  }

  public RoomStore.Page read(UUID id, long after, String bearer) {
    if (after < 0) throw new RoomFailure("COLLABORATION_INVALID_CURSOR");
    documents.check(id, bearer);
    // Reads may overlap the short interval between native commit and room completion.
    // Write/checkpoint handlers enforce the native head; polling never kills a
    // healthy session because of that expected two-service visibility window.
    return rooms.read(id, after);
  }
}
