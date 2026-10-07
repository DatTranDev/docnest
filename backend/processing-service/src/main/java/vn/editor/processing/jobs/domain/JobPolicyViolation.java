package vn.editor.processing.jobs.domain;

public final class JobPolicyViolation extends RuntimeException {
  private final String code;

  public JobPolicyViolation(String code, String message) {
    super(message);
    this.code = code;
  }

  public String code() {
    return code;
  }
}
