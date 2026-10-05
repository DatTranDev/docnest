package vn.editor.document.documents.domain;

public final class UploadPolicy {
  public static final long MAX_NATIVE_BYTES = 32L * 1024 * 1024;
  public static final long MIN_NATIVE_BYTES = 20;
  public static final long TICKET_SECONDS = 900;
  public static final long VALIDATION_LEASE_SECONDS = 120;
  public static final int MAX_PENDING_UPLOADS = 10;

  private UploadPolicy() {}
}
