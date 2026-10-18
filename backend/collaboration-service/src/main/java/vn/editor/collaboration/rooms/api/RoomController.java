package vn.editor.collaboration.rooms.api;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vn.editor.collaboration.rooms.application.command.PresenceCommandService;
import vn.editor.collaboration.rooms.application.command.RoomCommandService;
import vn.editor.collaboration.rooms.application.port.PresenceRepository;
import vn.editor.collaboration.rooms.application.port.RoomRepository;
import vn.editor.collaboration.rooms.application.query.PresenceQueryService;
import vn.editor.collaboration.rooms.application.query.RoomQueryService;
import vn.editor.collaboration.rooms.domain.RoomFailure;
import vn.editor.collaboration.rooms.domain.RoomPolicy;

@RestController
@RequestMapping("/api/v1/collaboration/{id}")
public class RoomController {
  private final RoomCommandService commands;
  private final RoomQueryService queries;
  private final PresenceCommandService presenceCommands;
  private final PresenceQueryService presenceQueries;

  public RoomController(
      RoomCommandService commands,
      RoomQueryService queries,
      PresenceCommandService presenceCommands,
      PresenceQueryService presenceQueries) {
    this.commands = commands;
    this.queries = queries;
    this.presenceCommands = presenceCommands;
    this.presenceQueries = presenceQueries;
  }

  public record PresenceUpdate(Integer anchor, Integer head) {}

  @PostMapping("/presence/{sessionId}")
  public ResponseEntity<?> heartbeat(
      @PathVariable UUID id,
      @PathVariable UUID sessionId,
      @RequestBody PresenceUpdate update,
      @AuthenticationPrincipal Jwt jwt) {
    presenceCommands.heartbeat(
        id,
        sessionId,
        UUID.fromString(jwt.getSubject()),
        update.anchor(),
        update.head(),
        jwt.getTokenValue());
    return ResponseEntity.noContent().build();
  }

  @GetMapping("/presence")
  public java.util.List<PresenceRepository.Member> presence(
      @PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
    return presenceQueries.list(id, jwt.getTokenValue());
  }

  @DeleteMapping("/presence/{sessionId}")
  public ResponseEntity<?> leave(
      @PathVariable UUID id, @PathVariable UUID sessionId, @AuthenticationPrincipal Jwt jwt) {
    presenceCommands.leave(id, sessionId, UUID.fromString(jwt.getSubject()));
    return ResponseEntity.noContent().build();
  }

  @PostMapping(value = "/join", consumes = "application/octet-stream")
  public RoomRepository.Page join(
      @PathVariable UUID id,
      @RequestParam long headRevision,
      @AuthenticationPrincipal Jwt jwt,
      HttpServletRequest request)
      throws IOException {
    return commands.join(id, headRevision, payload(request), jwt.getTokenValue());
  }

  @GetMapping("/updates")
  public RoomRepository.Page read(
      @PathVariable UUID id,
      @RequestParam(defaultValue = "0") long after,
      @AuthenticationPrincipal Jwt jwt) {
    return queries.read(id, after, jwt.getTokenValue());
  }

  @PostMapping(value = "/updates/{operationId}", consumes = "application/octet-stream")
  public Map<String, Long> append(
      @PathVariable UUID id,
      @PathVariable UUID operationId,
      @AuthenticationPrincipal Jwt jwt,
      HttpServletRequest request)
      throws IOException {
    return Map.of(
        "sequence",
        commands.append(
            id,
            operationId,
            UUID.fromString(jwt.getSubject()),
            payload(request),
            jwt.getTokenValue()));
  }

  private byte[] payload(HttpServletRequest request) throws IOException {
    if (request.getContentLengthLong() > RoomPolicy.MAX_UPDATE_BYTES)
      throw new RoomFailure("COLLABORATION_UPDATE_LIMIT");
    byte[] payload = request.getInputStream().readNBytes(RoomPolicy.MAX_UPDATE_BYTES + 1);
    RoomPolicy.update(payload);
    return payload;
  }

  @PostMapping(value = "/checkpoint", consumes = "application/octet-stream")
  public Map<String, Long> checkpoint(
      @PathVariable UUID id,
      @RequestParam long sequence,
      @AuthenticationPrincipal Jwt jwt,
      HttpServletRequest request)
      throws IOException {
    int maximum = 32 * 1024 * 1024;
    if (request.getContentLengthLong() > maximum)
      throw new RoomFailure("COLLABORATION_UPDATE_LIMIT");
    byte[] nativeFile = request.getInputStream().readNBytes(maximum + 1);
    return Map.of("revision", commands.checkpoint(id, sequence, nativeFile, jwt.getTokenValue()));
  }

  @ExceptionHandler(RoomFailure.class)
  public ResponseEntity<Map<String, String>> failure(RoomFailure failure) {
    int status =
        switch (failure.getMessage()) {
          case "COLLABORATION_NOT_FOUND" -> 404;
          case "COLLABORATION_UNAUTHENTICATED" -> 401;
          case "COLLABORATION_READ_ONLY" -> 403;
          case "COLLABORATION_HEAD_CHANGED", "COLLABORATION_IDEMPOTENCY_CONFLICT" -> 409;
          case "COLLABORATION_CHECKPOINT_BUSY" -> 423;
          case "COLLABORATION_UPDATE_LIMIT", "COLLABORATION_LOG_LIMIT" -> 413;
          case "COLLABORATION_ACCESS_UNAVAILABLE",
              "COLLABORATION_STORAGE_UNAVAILABLE",
              "COLLABORATION_SAVE_FAILED" ->
              503;
          default -> 400;
        };
    return ResponseEntity.status(status)
        .body(Map.of("code", failure.getMessage(), "message", failure.getMessage()));
  }
}
