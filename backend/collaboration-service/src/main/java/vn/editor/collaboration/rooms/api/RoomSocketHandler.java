package vn.editor.collaboration.rooms.api;

import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import vn.editor.collaboration.rooms.application.port.DocumentAccess;
import vn.editor.collaboration.rooms.application.port.RoomRepository;

/** A bounded notification channel; HTTP commands remain the authoritative CRDT transport. */
@Component
public final class RoomSocketHandler extends TextWebSocketHandler {
  private static final int MAX_TOKEN_LENGTH = 8192;
  private static final long ACCESS_INTERVAL_MS = 2500;
  private final JwtDecoder tokens;
  private final DocumentAccess documents;
  private final RoomRepository rooms;
  private final ConcurrentHashMap<String, Client> clients = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, Pending> pending = new ConcurrentHashMap<>();

  public RoomSocketHandler(JwtDecoder tokens, DocumentAccess documents, RoomRepository rooms) {
    this.tokens = tokens;
    this.documents = documents;
    this.rooms = rooms;
  }

  private record Client(
      WebSocketSession session, UUID documentId, String token, long sequence, long checkedAt) {}

  private record Pending(WebSocketSession session, long openedAt) {}

  @Override
  public void afterConnectionEstablished(WebSocketSession session) {
    pending.put(session.getId(), new Pending(session, System.currentTimeMillis()));
  }

  @Override
  protected void handleTextMessage(WebSocketSession session, TextMessage message) {
    if (!pending.containsKey(session.getId())
        || clients.containsKey(session.getId())
        || message.getPayloadLength() > MAX_TOKEN_LENGTH) {
      close(session);
      return;
    }
    try {
      var segments = session.getUri().getPath().split("/");
      if (segments.length != 6 || !segments[5].equals("socket")) {
        close(session);
        return;
      }
      UUID id = UUID.fromString(segments[4]);
      String token = message.getPayload();
      UUID.fromString(tokens.decode(token).getSubject());
      documents.check(id, token);
      long sequence = rooms.read(id, Long.MAX_VALUE).sequence();
      clients.put(
          session.getId(), new Client(session, id, token, sequence, System.currentTimeMillis()));
      pending.remove(session.getId());
      send(session, "READY:" + sequence);
    } catch (RuntimeException error) {
      close(session);
    }
  }

  @Override
  public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
    clients.remove(session.getId());
    pending.remove(session.getId());
  }

  @Scheduled(fixedDelay = 1000)
  public void notifyChanges() {
    long now = System.currentTimeMillis();
    for (var entry : pending.entrySet()) {
      if (now - entry.getValue().openedAt() > 5000) close(entry.getValue().session());
    }
    for (var entry : clients.entrySet()) {
      Client client = entry.getValue();
      try {
        if (!client.session().isOpen()) {
          clients.remove(entry.getKey(), client);
          continue;
        }
        if (now - client.checkedAt() >= ACCESS_INTERVAL_MS) {
          tokens.decode(client.token());
          documents.check(client.documentId(), client.token());
        }
        long sequence = rooms.read(client.documentId(), Long.MAX_VALUE).sequence();
        if (sequence > client.sequence()) send(client.session(), "UPDATE:" + sequence);
        clients.replace(
            entry.getKey(),
            client,
            new Client(
                client.session(),
                client.documentId(),
                client.token(),
                sequence,
                now - client.checkedAt() >= ACCESS_INTERVAL_MS ? now : client.checkedAt()));
      } catch (RuntimeException error) {
        clients.remove(entry.getKey(), client);
        close(client.session());
      }
    }
  }

  private void send(WebSocketSession session, String message) {
    try {
      synchronized (session) {
        if (session.isOpen()) session.sendMessage(new TextMessage(message));
      }
    } catch (IOException error) {
      close(session);
    }
  }

  private void close(WebSocketSession session) {
    clients.remove(session.getId());
    pending.remove(session.getId());
    try {
      session.close(CloseStatus.POLICY_VIOLATION);
    } catch (IOException ignored) {
      // A dropped peer has no remaining session state.
    }
  }
}
