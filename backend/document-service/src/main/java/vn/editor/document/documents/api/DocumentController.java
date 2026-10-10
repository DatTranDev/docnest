package vn.editor.document.documents.api;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.io.InputStream;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;
import vn.editor.document.documents.api.dto.ChangeDocumentMetadataRequestDto;
import vn.editor.document.documents.api.dto.CreateDocumentRequestDto;
import vn.editor.document.documents.api.dto.CreateUploadRequestDto;
import vn.editor.document.documents.api.dto.MetadataRevisionRequestDto;
import vn.editor.document.documents.api.dto.SaveVersionRequestDto;
import vn.editor.document.documents.application.command.DocumentCommandService;
import vn.editor.document.documents.application.command.SaveDocumentCommandService;
import vn.editor.document.documents.application.command.SaveResult;
import vn.editor.document.documents.application.command.UploadCommandService;
import vn.editor.document.documents.application.query.DocumentQueryService;
import vn.editor.document.documents.application.query.GetDocumentQuery;
import vn.editor.document.documents.application.query.GetVersionQuery;
import vn.editor.document.documents.application.query.ListDocumentsQuery;
import vn.editor.document.documents.application.query.ListVersionsQuery;
import vn.editor.document.shared.api.Streams;
import vn.editor.document.shared.domain.Values;

@RestController
public class DocumentController {
  private final DocumentCommandService commands;
  private final DocumentQueryService queries;
  private final UploadCommandService uploads;
  private final SaveDocumentCommandService saves;

  public DocumentController(
      DocumentCommandService commands,
      DocumentQueryService queries,
      UploadCommandService uploads,
      SaveDocumentCommandService saves) {
    this.commands = commands;
    this.queries = queries;
    this.uploads = uploads;
    this.saves = saves;
  }

  private String actor(Jwt jwt) {
    return Values.id(jwt.getSubject());
  }

  @GetMapping("/api/v1/documents")
  Object documents(
      @AuthenticationPrincipal Jwt jwt,
      @RequestParam(defaultValue = "OWNED") String scope,
      @RequestParam(defaultValue = "root") String parent,
      @RequestParam(required = false) String titleQuery,
      @RequestParam(required = false) String cursor,
      @RequestParam(defaultValue = "50") int limit) {
    return queries.handle(
        new ListDocumentsQuery(actor(jwt), scope, parent, titleQuery, cursor, limit));
  }

  @PostMapping("/api/v1/documents")
  ResponseEntity<?> createDocument(
      @AuthenticationPrincipal Jwt jwt, @RequestBody CreateDocumentRequestDto request) {
    return ResponseEntity.status(201).body(commands.handle(request.command(actor(jwt))));
  }

  @GetMapping("/api/v1/documents/{id}")
  Object document(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
    return queries.handle(new GetDocumentQuery(actor(jwt), id));
  }

  @PatchMapping("/api/v1/documents/{id}")
  Object patchDocument(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable String id,
      @RequestBody ChangeDocumentMetadataRequestDto request) {
    return commands.handle(request.command(actor(jwt), id));
  }

  @DeleteMapping("/api/v1/documents/{id}")
  ResponseEntity<?> trash(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable String id,
      @RequestBody MetadataRevisionRequestDto request) {
    commands.handle(request.command(actor(jwt), id, false));
    return ResponseEntity.noContent().build();
  }

  @PostMapping("/api/v1/documents/{id}/restore")
  Object restore(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable String id,
      @RequestBody MetadataRevisionRequestDto request) {
    return commands.handle(request.command(actor(jwt), id, true));
  }

  @GetMapping("/api/v1/documents/{id}/versions")
  Object versions(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable String id,
      @RequestParam(required = false) String cursor,
      @RequestParam(defaultValue = "50") int limit) {
    return queries.handle(new ListVersionsQuery(actor(jwt), id, cursor, limit));
  }

  @PostMapping("/api/v1/documents/{id}/uploads")
  ResponseEntity<?> uploadTicket(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable String id,
      @RequestBody CreateUploadRequestDto request)
      throws IOException {
    return ResponseEntity.status(201).body(uploads.handle(request.command(actor(jwt), id)));
  }

  @PutMapping("/api/v1/uploads/{id}/content")
  ResponseEntity<?> upload(
      @AuthenticationPrincipal Jwt jwt, @PathVariable String id, HttpServletRequest request)
      throws IOException {
    uploads.upload(actor(jwt), id, request.getContentLengthLong(), request.getInputStream());
    return ResponseEntity.noContent().build();
  }

  @PostMapping("/api/v1/documents/{id}/versions")
  ResponseEntity<?> commit(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable String id,
      @RequestHeader("Idempotency-Key") String key,
      @RequestBody SaveVersionRequestDto request)
      throws IOException {
    SaveResult c = saves.handle(request.command(actor(jwt), id, key));
    return ResponseEntity.status(c.status()).body(c.body());
  }

  @GetMapping("/api/v1/documents/{id}/versions/{revision}/download")
  Object descriptor(
      @AuthenticationPrincipal Jwt jwt, @PathVariable String id, @PathVariable long revision) {
    return queries.download(new GetVersionQuery(actor(jwt), id, revision));
  }

  @GetMapping("/api/v1/documents/{id}/versions/{revision}/content")
  ResponseEntity<StreamingResponseBody> content(
      @AuthenticationPrincipal Jwt jwt, @PathVariable String id, @PathVariable long revision)
      throws IOException {
    InputStream input = queries.content(new GetVersionQuery(actor(jwt), id, revision));
    return Streams.nativeDocument(input, null);
  }
}
