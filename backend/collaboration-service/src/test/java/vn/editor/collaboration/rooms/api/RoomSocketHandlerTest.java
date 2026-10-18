package vn.editor.collaboration.rooms.api;

import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.net.URI;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import vn.editor.collaboration.rooms.application.port.DocumentAccess;
import vn.editor.collaboration.rooms.application.port.RoomRepository;
import vn.editor.collaboration.rooms.domain.RoomFailure;

class RoomSocketHandlerTest {
  @Test
  void acceptsOnlyValidatedTokenWithCurrentDocumentAccess() throws Exception {
    UUID id = UUID.randomUUID();
    var tokens = mock(JwtDecoder.class);
    var documents = mock(DocumentAccess.class);
    var rooms = mock(RoomRepository.class);
    var session = session(id);
    when(tokens.decode("valid"))
        .thenReturn(
            Jwt.withTokenValue("valid")
                .header("alg", "RS256")
                .subject(UUID.randomUUID().toString())
                .build());
    when(documents.check(id, "valid")).thenReturn(new DocumentAccess.Access(1, false));
    when(rooms.read(id, Long.MAX_VALUE)).thenReturn(new RoomRepository.Page(1, 4, List.of()));
    var handler = new RoomSocketHandler(tokens, documents, rooms);
    handler.afterConnectionEstablished(session);
    handler.handleTextMessage(session, new TextMessage("valid"));
    verify(session).sendMessage(argThat(message -> message.getPayload().equals("READY:4")));
    verify(documents).check(id, "valid");
  }

  @Test
  void closesInvalidOrRevokedSessions() throws Exception {
    UUID id = UUID.randomUUID();
    var tokens = mock(JwtDecoder.class);
    var documents = mock(DocumentAccess.class);
    var rooms = mock(RoomRepository.class);
    var invalid = session(id);
    when(tokens.decode("invalid")).thenThrow(new BadJwtException("invalid"));
    var handler = new RoomSocketHandler(tokens, documents, rooms);
    handler.afterConnectionEstablished(invalid);
    handler.handleTextMessage(invalid, new TextMessage("invalid"));
    verify(invalid).close(CloseStatus.POLICY_VIOLATION);

    var revoked = session(id);
    when(revoked.getId()).thenReturn("revoked");
    when(revoked.isOpen()).thenReturn(true);
    when(tokens.decode("valid"))
        .thenReturn(
            Jwt.withTokenValue("valid")
                .header("alg", "RS256")
                .subject(UUID.randomUUID().toString())
                .build());
    when(documents.check(id, "valid"))
        .thenReturn(new DocumentAccess.Access(1, true))
        .thenThrow(new RoomFailure("COLLABORATION_NOT_FOUND"));
    when(rooms.read(id, Long.MAX_VALUE)).thenReturn(new RoomRepository.Page(1, 1, List.of()));
    handler.afterConnectionEstablished(revoked);
    handler.handleTextMessage(revoked, new TextMessage("valid"));
    Thread.sleep(2600);
    handler.notifyChanges();
    verify(revoked).close(CloseStatus.POLICY_VIOLATION);
  }

  private WebSocketSession session(UUID documentId) {
    var session = mock(WebSocketSession.class);
    when(session.getId()).thenReturn(UUID.randomUUID().toString());
    when(session.getUri())
        .thenReturn(URI.create("ws://localhost/api/v1/collaboration/" + documentId + "/socket"));
    when(session.isOpen()).thenReturn(true);
    return session;
  }
}
