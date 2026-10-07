package vn.editor.processing.jobs.application;

public final class JobFailure extends RuntimeException {
  public final int status;
  public final String code;

  public JobFailure(int status, String code, String message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
