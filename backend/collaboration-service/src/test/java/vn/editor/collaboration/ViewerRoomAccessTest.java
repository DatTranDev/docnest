package vn.editor.collaboration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import vn.editor.collaboration.rooms.application.command.RoomCommandHandler;
import vn.editor.collaboration.rooms.application.port.DocumentAccess;
import vn.editor.collaboration.rooms.application.port.RoomRepository;
import vn.editor.collaboration.rooms.application.query.RoomQueryHandler;
import vn.editor.collaboration.rooms.domain.RoomFailure;

class ViewerRoomAccessTest {
  @Test
  void viewerCanReadExistingRoomButCannotSeedOrAppend() {
    UUID id = UUID.randomUUID();
    var access = mock(DocumentAccess.class);
    var rooms = mock(RoomRepository.class);
    var page = new RoomRepository.Page(7, 1, List.of());
    when(access.check(id, "viewer-token")).thenReturn(new DocumentAccess.Access(7, false));
    when(rooms.read(id, 0)).thenReturn(page);
    var commands = new RoomCommandHandler(rooms, access);
    assertEquals(page, commands.join(id, 7, new byte[] {1}, "viewer-token"));
    verify(rooms, never()).join(id, 7, new byte[] {1});
    assertThrows(
        RoomFailure.class,
        () ->
            commands.append(
                id, UUID.randomUUID(), UUID.randomUUID(), new byte[] {1}, "viewer-token"));
  }

  @Test
  void revocationBlocksSubsequentSyncReads() {
    UUID id = UUID.randomUUID();
    var access = mock(DocumentAccess.class);
    var rooms = mock(RoomRepository.class);
    when(access.check(id, "token"))
        .thenReturn(new DocumentAccess.Access(1, true))
        .thenThrow(new RoomFailure("COLLABORATION_NOT_FOUND"));
    when(rooms.read(id, 0)).thenReturn(new RoomRepository.Page(1, 0, List.of()));
    var queries = new RoomQueryHandler(rooms, access);
    queries.read(id, 0, "token");
    assertThrows(RoomFailure.class, () -> queries.read(id, 0, "token"));
  }

  @Test
  void viewerCannotJoinRoomForAnotherNativeRevision() {
    UUID id = UUID.randomUUID();
    var access = mock(DocumentAccess.class);
    var rooms = mock(RoomRepository.class);
    when(access.check(id, "viewer-token")).thenReturn(new DocumentAccess.Access(7, false));
    when(rooms.read(id, 0)).thenReturn(new RoomRepository.Page(6, 1, List.of()));
    var commands = new RoomCommandHandler(rooms, access);
    assertThrows(RoomFailure.class, () -> commands.join(id, 7, new byte[] {1}, "viewer-token"));
  }
}
