package vn.editor.document.sharing.api;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.Map;
import java.util.Objects;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;
import vn.editor.document.shared.api.Streams;
import vn.editor.document.shared.application.Page;
import vn.editor.document.shared.domain.DomainException;
import vn.editor.document.shared.domain.Values;
import vn.editor.document.sharing.application.command.CreatePublicLinkCommand;
import vn.editor.document.sharing.application.command.GrantDocumentAccessByEmailCommand;
import vn.editor.document.sharing.application.command.GrantDocumentAccessCommand;
import vn.editor.document.sharing.application.command.RevokeDocumentAccessCommand;
import vn.editor.document.sharing.application.command.RevokePublicLinkCommand;
import vn.editor.document.sharing.application.command.SharingCommandHandler;
import vn.editor.document.sharing.application.query.ListPermissionsQuery;
import vn.editor.document.sharing.application.query.ListPublicLinksQuery;
import vn.editor.document.sharing.application.query.PermissionView;
import vn.editor.document.sharing.application.query.PublicShareQueryHandler;
import vn.editor.document.sharing.application.query.SharingQueryHandler;

@RestController
public class SharingController {
  private final SharingCommandHandler commands;
  private final SharingQueryHandler queries;
  private final PublicShareQueryHandler publicShares;

  public SharingController(
      SharingCommandHandler commands,
      SharingQueryHandler queries,
      PublicShareQueryHandler publicShares) {
    this.commands = commands;
    this.queries = queries;
    this.publicShares = publicShares;
  }

  private String actor(Jwt jwt) {
    return Values.id(jwt.getSubject());
  }

  @GetMapping("/api/v1/documents/{id}/permissions")
  Object permissions(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable String id,
      @RequestHeader("Authorization") String authorization,
      @RequestParam(required = false) String cursor,
      @RequestParam(defaultValue = "50") int limit) {
    Page<PermissionView> page =
        queries.handle(new ListPermissionsQuery(actor(jwt), id, authorization, cursor, limit));
    return new Page<>(
        page.items().stream().map(SharingController::permission).toList(), page.nextCursor());
  }

  @PostMapping("/api/v1/documents/{id}/permissions")
  Object grantEmail(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable String id,
      @RequestHeader("Authorization") String authorization,
      @RequestBody Map<String, Object> body) {
    Values.fields(body, "email,role", "");
    if (!(body.get("email") instanceof String email))
      throw new DomainException(400, "INVALID_REQUEST");
    return permission(
        commands.handle(
            new GrantDocumentAccessByEmailCommand(
                actor(jwt), id, email, Objects.toString(body.get("role"), ""), authorization)));
  }

  @PutMapping("/api/v1/documents/{id}/permissions/{grantee}")
  Object grant(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable String id,
      @PathVariable String grantee,
      @RequestHeader("Authorization") String authorization,
      @RequestBody Map<String, Object> body) {
    Values.fields(body, "role", "");
    return permission(
        commands.handle(
            new GrantDocumentAccessCommand(
                actor(jwt), id, grantee, Objects.toString(body.get("role"), ""), authorization)));
  }

  @DeleteMapping("/api/v1/documents/{id}/permissions/{grantee}")
  ResponseEntity<?> revoke(
      @AuthenticationPrincipal Jwt jwt, @PathVariable String id, @PathVariable String grantee) {
    commands.handle(new RevokeDocumentAccessCommand(actor(jwt), id, grantee));
    return ResponseEntity.noContent().build();
  }

  @GetMapping("/api/v1/documents/{id}/share-links")
  Object links(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable String id,
      @RequestParam(required = false) String cursor,
      @RequestParam(defaultValue = "50") int limit) {
    return queries.handle(new ListPublicLinksQuery(actor(jwt), id, cursor, limit));
  }

  @PostMapping("/api/v1/documents/{id}/share-links")
  ResponseEntity<?> createLink(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable String id,
      @RequestBody Map<String, Object> body) {
    Values.fields(body, "", "expiresInSeconds");
    return ResponseEntity.status(201)
        .body(
            commands.handle(
                new CreatePublicLinkCommand(
                    actor(jwt),
                    id,
                    body.containsKey("expiresInSeconds")
                        ? Values.integer(body.get("expiresInSeconds"), 3600, 2592000)
                        : 604800)));
  }

  @DeleteMapping("/api/v1/documents/{id}/share-links/{link}")
  ResponseEntity<?> revokeLink(
      @AuthenticationPrincipal Jwt jwt, @PathVariable String id, @PathVariable String link) {
    commands.handle(new RevokePublicLinkCommand(actor(jwt), id, link));
    return ResponseEntity.noContent().build();
  }

  @GetMapping("/api/v1/public/shares/{token}")
  ResponseEntity<?> publicDocument(@PathVariable String token, HttpServletRequest request) {
    return ResponseEntity.ok()
        .header("Cache-Control", "no-store")
        .header("Referrer-Policy", "no-referrer")
        .body(publicShares.document(token, request.getRemoteAddr()));
  }

  @GetMapping("/api/v1/public/shares/{token}/content")
  ResponseEntity<StreamingResponseBody> publicContent(
      @PathVariable String token, HttpServletRequest request) throws IOException {
    PublicShareQueryHandler.Content content = publicShares.content(token, request.getRemoteAddr());
    return Streams.nativeDocument(content.input(), content.lease()::close);
  }

  private static Map<String, Object> permission(PermissionView view) {
    Map<String, Object> result =
        Values.map(
            "granteeUserId",
            view.granteeUserId(),
            "role",
            view.role(),
            "updatedAt",
            view.updatedAt());
    if (view.email() != null) result.put("email", view.email());
    if (view.displayName() != null) result.put("displayName", view.displayName());
    return result;
  }
}
