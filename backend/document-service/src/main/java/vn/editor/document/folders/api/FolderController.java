package vn.editor.document.folders.api;

import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vn.editor.document.folders.api.dto.CreateFolderRequestDto;
import vn.editor.document.folders.api.dto.MoveFolderRequestDto;
import vn.editor.document.folders.application.command.DeleteFolderCommand;
import vn.editor.document.folders.application.command.FolderCommandService;
import vn.editor.document.folders.application.query.FolderQueryService;
import vn.editor.document.folders.application.query.GetFolderQuery;
import vn.editor.document.folders.application.query.ListFoldersQuery;
import vn.editor.document.shared.domain.Values;

@RestController
public class FolderController {
  private final FolderCommandService commands;
  private final FolderQueryService queries;

  public FolderController(FolderCommandService commands, FolderQueryService queries) {
    this.commands = commands;
    this.queries = queries;
  }

  private String actor(Jwt jwt) {
    return Values.id(jwt.getSubject());
  }

  @GetMapping("/api/v1/folders")
  Object folders(
      @AuthenticationPrincipal Jwt jwt,
      @RequestParam(defaultValue = "root") String parent,
      @RequestParam(required = false) String cursor,
      @RequestParam(defaultValue = "50") int limit) {
    return queries.handle(new ListFoldersQuery(actor(jwt), parent, cursor, limit));
  }

  @PostMapping("/api/v1/folders")
  ResponseEntity<?> createFolder(
      @AuthenticationPrincipal Jwt jwt, @RequestBody CreateFolderRequestDto request) {
    return ResponseEntity.status(201).body(commands.handle(request.command(actor(jwt))));
  }

  @GetMapping("/api/v1/folders/{id}")
  Object folder(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
    return queries.handle(new GetFolderQuery(actor(jwt), id));
  }

  @PatchMapping("/api/v1/folders/{id}")
  Object patchFolder(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable String id,
      @RequestBody MoveFolderRequestDto request) {
    return commands.handle(request.command(actor(jwt), id));
  }

  @DeleteMapping("/api/v1/folders/{id}")
  ResponseEntity<?> deleteFolder(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable String id,
      @RequestParam long expectedMetadataRevision) {
    commands.handle(new DeleteFolderCommand(actor(jwt), id, expectedMetadataRevision));
    return ResponseEntity.noContent().build();
  }
}
