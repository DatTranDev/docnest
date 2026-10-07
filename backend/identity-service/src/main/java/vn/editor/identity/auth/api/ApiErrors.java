package vn.editor.identity.auth.api;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import vn.editor.common.observability.TraceContext;
import vn.editor.identity.auth.domain.AuthenticationFailure;

@RestControllerAdvice
public final class ApiErrors {
  @ExceptionHandler(AuthenticationFailure.class)
  public ResponseEntity<?> handle(AuthenticationFailure failure) {
    int status =
        switch (failure.reason()) {
          case INVALID_EMAIL, INVALID_PASSWORD, INVALID_DISPLAY_NAME -> 400;
          case EMAIL_ALREADY_REGISTERED -> 409;
          case ACCOUNT_QUOTA, RATE_LIMITED -> 429;
          case INVALID_CREDENTIALS -> 401;
          case ACCOUNT_UNAVAILABLE -> 404;
          case USER_NOT_REGISTERED -> 422;
          case INVALID_SERVICE_CALLER -> 403;
        };
    String code =
        failure.reason() == AuthenticationFailure.Reason.ACCOUNT_QUOTA
            ? "QUOTA_EXCEEDED"
            : failure.reason() == AuthenticationFailure.Reason.ACCOUNT_UNAVAILABLE
                ? "USER_NOT_REGISTERED"
                : failure.reason().name();
    var response = ResponseEntity.status(status);
    if (failure.reason() == AuthenticationFailure.Reason.RATE_LIMITED)
      response.header("Retry-After", "60");
    return response.body(
        Map.of("code", code, "message", failure.getMessage(), "traceId", TraceContext.traceId()));
  }

  @ExceptionHandler({IllegalArgumentException.class, HttpMessageNotReadableException.class})
  public ResponseEntity<?> badRequest(Exception failure) {
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
