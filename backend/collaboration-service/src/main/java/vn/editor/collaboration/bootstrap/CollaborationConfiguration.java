package vn.editor.collaboration.bootstrap;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
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

  @Bean
  JwtDecoder jwtDecoder(
      @Value("${editor.jwt.issuer}") String issuer, @Value("${editor.jwt.jwk-uri}") String uri) {
    var decoder =
        NimbusJwtDecoder.withJwkSetUri(uri).jwsAlgorithm(SignatureAlgorithm.RS256).build();
    decoder.setJwtValidator(
        new DelegatingOAuth2TokenValidator<>(
            JwtValidators.createDefaultWithIssuer(issuer),
            (Jwt jwt) ->
                jwt.getAudience().contains("editor-api")
                    ? OAuth2TokenValidatorResult.success()
                    : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token"))));
    return decoder;
  }

  @Bean
  SecurityFilterChain security(HttpSecurity http) throws Exception {
    return http.csrf(c -> c.disable())
        .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .headers(h -> h.cacheControl(c -> {}))
        .authorizeHttpRequests(
            a ->
                a.requestMatchers(HttpMethod.GET, "/actuator/prometheus")
                    .permitAll()
                    .requestMatchers("/actuator/health/**")
                    .permitAll()
                    .requestMatchers("/api/v1/collaboration/*/socket")
                    .permitAll()
                    .requestMatchers("/api/v1/collaboration/**")
                    .authenticated()
                    .anyRequest()
                    .denyAll())
        .oauth2ResourceServer(o -> o.jwt(j -> {}))
        .build();
  }
}
