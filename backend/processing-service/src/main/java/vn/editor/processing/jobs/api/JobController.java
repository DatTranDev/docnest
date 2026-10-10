package vn.editor.processing.jobs.api;

import java.io.IOException;
import java.util.Map;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vn.editor.processing.jobs.api.dto.CreateJobRequestDto;
import vn.editor.processing.jobs.application.command.CancelExportJobCommand;
import vn.editor.processing.jobs.application.command.CancelExportJobCommandService;
import vn.editor.processing.jobs.application.command.CreateExportJobCommand;
import vn.editor.processing.jobs.application.command.CreateExportJobCommandService;
import vn.editor.processing.jobs.application.query.GetJobDownloadQueryService;
import vn.editor.processing.jobs.application.query.GetJobQuery;
import vn.editor.processing.jobs.application.query.GetJobQueryService;
import vn.editor.processing.jobs.application.query.JobPage;
import vn.editor.processing.jobs.application.query.JobView;
import vn.editor.processing.jobs.application.query.ListJobsQuery;
import vn.editor.processing.jobs.application.query.ListJobsQueryService;
import vn.editor.processing.jobs.domain.ExportFormat;

@RestController
@RequestMapping("/api/v1/jobs")
public final class JobController {
  private final CreateExportJobCommandService create;
  private final CancelExportJobCommandService cancel;
  private final GetJobQueryService get;
  private final ListJobsQueryService list;
  private final GetJobDownloadQueryService download;

  public JobController(
      CreateExportJobCommandService create,
      CancelExportJobCommandService cancel,
      GetJobQueryService get,
      ListJobsQueryService list,
      GetJobDownloadQueryService download) {
    this.create = create;
    this.cancel = cancel;
    this.get = get;
    this.list = list;
    this.download = download;
  }

  @PostMapping
  public ResponseEntity<?> create(
      @AuthenticationPrincipal Jwt jwt,
      @RequestHeader("Authorization") String token,
      @RequestHeader("Idempotency-Key") String key,
      @RequestBody CreateJobRequestDto request) {
    return ResponseEntity.accepted()
        .body(
            create.handle(
                new CreateExportJobCommand(
                    jwt.getSubject(),
                    token,
                    key,
                    request.documentId(),
                    request.revision(),
                    request.type())));
  }

  @GetMapping
  public JobPage list(
      @AuthenticationPrincipal Jwt jwt,
      @RequestHeader("Authorization") String token,
      @RequestParam(defaultValue = "50") int limit,
      @RequestParam(required = false) String cursor) {
    return list.handle(new ListJobsQuery(jwt.getSubject(), token, limit, cursor));
  }

  @GetMapping("/{id}")
  public JobView get(
      @AuthenticationPrincipal Jwt jwt,
      @RequestHeader("Authorization") String token,
      @PathVariable String id) {
    return get.handle(new GetJobQuery(jwt.getSubject(), token, id));
  }

  @PostMapping("/{id}/cancel")
  public JobView cancel(
      @AuthenticationPrincipal Jwt jwt,
      @RequestHeader("Authorization") String token,
      @PathVariable String id) {
    return cancel.handle(new CancelExportJobCommand(jwt.getSubject(), token, id));
  }

  @GetMapping("/{id}/download")
  public Map<String, Object> download(
      @AuthenticationPrincipal Jwt jwt,
      @RequestHeader("Authorization") String token,
      @PathVariable String id) {
    return download.descriptor(new GetJobQuery(jwt.getSubject(), token, id));
  }

  @GetMapping("/{id}/content")
  public ResponseEntity<?> content(
      @AuthenticationPrincipal Jwt jwt,
      @RequestHeader("Authorization") String token,
      @PathVariable String id)
      throws IOException {
    var job = download.ready(new GetJobQuery(jwt.getSubject(), token, id));
    return ResponseEntity.ok()
        .contentType(MediaType.parseMediaType(download.contentType(job)))
        .contentLength(job.bytes())
        .header(HttpHeaders.CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header(
            HttpHeaders.CONTENT_DISPOSITION,
            "attachment; filename=\"export."
                + ExportFormat.valueOf(job.view().type()).extension()
                + "\"")
        .body(new InputStreamResource(download.open(job)));
  }
}
