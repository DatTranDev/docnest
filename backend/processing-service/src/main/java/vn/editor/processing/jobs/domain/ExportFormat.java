package vn.editor.processing.jobs.domain;

public enum ExportFormat {
  EXPORT_TXT("txt", "text/plain;charset=UTF-8"),
  EXPORT_HTML("html", "text/html;charset=UTF-8"),
  EXPORT_DOCX("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
  EXPORT_PDF("pdf", "application/pdf");
  private final String extension;
  private final String contentType;

  ExportFormat(String extension, String contentType) {
    this.extension = extension;
    this.contentType = contentType;
  }

  public String extension() {
    return extension;
  }

  public String contentType() {
    return contentType;
  }
}
