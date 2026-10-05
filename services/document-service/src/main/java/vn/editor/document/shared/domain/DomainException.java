package vn.editor.document.shared.domain;

import java.util.Map;

/** Stable business error codes, translated to HTTP exclusively by the API adapter. */
public final class DomainException extends RuntimeException {
  public final int status;
  public final String code;
  public final Map<String, Object> details;

  public DomainException(int status, String code) {
    this(status, code, Map.of());
  }

  public DomainException(int status, String code, Map<String, Object> details) {
    super(code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
