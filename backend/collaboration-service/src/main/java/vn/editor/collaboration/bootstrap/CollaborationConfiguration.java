package vn.editor.collaboration.bootstrap;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import vn.editor.collaboration.rooms.api.RoomSocketHandler;
import vn.editor.collaboration.rooms.application.command.PresenceCommandHandler;
import vn.editor.collaboration.rooms.application.command.RoomCommandHandler;
import vn.editor.collaboration.rooms.application.port.DocumentAccess;
import vn.editor.collaboration.rooms.application.port.PresenceRepository;
import vn.editor.collaboration.rooms.application.port.RoomRepository;
import vn.editor.collaboration.rooms.application.query.PresenceQueryHandler;
import vn.editor.collaboration.rooms.application.query.RoomQueryHandler;

@Configuration
@EnableScheduling
@EnableWebSocket
public class CollaborationConfiguration implements WebSocketConfigurer {
  private final RoomSocketHandler sockets;

  public CollaborationConfiguration(RoomSocketHandler sockets) {
    this.sockets = sockets;
  }

  @Override
  public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
    registry.addHandler(sockets, "/api/v1/collaboration/*/socket").setAllowedOriginPatterns("*");
  }

  @Bean
  PresenceCommandHandler presenceCommands(PresenceRepository presence, DocumentAccess access) {
    return new PresenceCommandHandler(presence, access);
  }

  @Bean
  PresenceQueryHandler presenceQueries(PresenceRepository presence, DocumentAccess access) {
    return new PresenceQueryHandler(presence, access);
  }

  @Bean
  RoomCommandHandler commands(RoomRepository rooms, DocumentAccess access) {
    return new RoomCommandHandler(rooms, access);
  }

  @Bean
  RoomQueryHandler queries(RoomRepository rooms, DocumentAccess access) {
    return new RoomQueryHandler(rooms, access);
  }
}
