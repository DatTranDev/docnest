package vn.editor.identity.auth.domain;

public final class AuthenticationFailure extends RuntimeException {
  public enum Reason {
    INVALID_EMAIL,
    INVALID_PASSWORD,
    INVALID_DISPLAY_NAME,
    EMAIL_ALREADY_REGISTERED,
    ACCOUNT_QUOTA,
    INVALID_CREDENTIALS,
    ACCOUNT_UNAVAILABLE,
    USER_NOT_REGISTERED,
    INVALID_SERVICE_CALLER,
    RATE_LIMITED
  }

  private final Reason reason;

  public AuthenticationFailure(Reason reason, String message) {
    super(message);
    this.reason = reason;
  }

  public Reason reason() {
    return reason;
  }

  public static AuthenticationFailure credentials() {
    return new AuthenticationFailure(Reason.INVALID_CREDENTIALS, "Authentication failed");
  }
}
