package vn.editor.document.shared.api;

import java.io.FileNotFoundException;
import java.io.IOException;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import vn.editor.common.observability.TraceContext;
import vn.editor.document.shared.domain.DomainException;
import vn.editor.document.shared.domain.Values;

@RestControllerAdvice
public class Errors {
  @ExceptionHandler(DomainException.class)
  ResponseEntity<?> api(DomainException e) {
    Map<String, Object> b =
        Values.map("code", e.code, "message", e.code, "traceId", TraceContext.traceId());
    if (!e.details.isEmpty()) b.put("details", e.details);
    return ResponseEntity.status(e.status).body(b);
  }

  @ExceptionHandler(IOException.class)
  ResponseEntity<?> io(IOException e) {
    if ("FILE_TOO_LARGE".equals(e.getMessage()))
      return api(new DomainException(413, "FILE_TOO_LARGE"));
    if ("UPLOAD_SIZE_MISMATCH".equals(e.getMessage()))
      return api(new DomainException(422, "UPLOAD_SIZE_MISMATCH"));
    if (e instanceof java.nio.file.NoSuchFileException || e instanceof FileNotFoundException)
      return api(new DomainException(422, "UPLOAD_NOT_COMPLETED"));
    return api(new DomainException(503, "STORAGE_UNAVAILABLE"));
  }

  @ExceptionHandler({
    org.springframework.http.converter.HttpMessageNotReadableException.class,
    org.springframework.web.bind.MissingRequestHeaderException.class,
    org.springframework.web.bind.MissingServletRequestParameterException.class,
    org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class
  })
  ResponseEntity<?> bad(Exception e) {
    return api(new DomainException(400, "INVALID_REQUEST"));
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<?> unexpected(Exception e) {
    return api(new DomainException(503, "SERVICE_UNAVAILABLE"));
  }
}
