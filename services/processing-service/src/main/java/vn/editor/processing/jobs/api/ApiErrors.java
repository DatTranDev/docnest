package vn.editor.processing.jobs.api;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import vn.editor.common.observability.TraceContext;
import vn.editor.processing.jobs.application.JobFailure;

@RestControllerAdvice
public final class ApiErrors {
  @ExceptionHandler(JobFailure.class)
  ResponseEntity<?> handle(JobFailure e) {
    return ResponseEntity.status(e.status)
        .body(Map.of("code", e.code, "message", e.getMessage(), "traceId", TraceContext.traceId()));
  }

  @ExceptionHandler({
    IllegalArgumentException.class,
    org.springframework.http.converter.HttpMessageNotReadableException.class
  })
  ResponseEntity<?> bad(Exception e) {
    return ResponseEntity.badRequest()
        .body(
            Map.of(
                "code",
                "INVALID_REQUEST",
                "message",
                "Invalid request",
                "traceId",
                TraceContext.traceId()));
  }
}
