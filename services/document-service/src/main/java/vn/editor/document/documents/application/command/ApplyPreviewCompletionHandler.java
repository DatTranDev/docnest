package vn.editor.document.documents.application.command;

import vn.editor.document.documents.application.port.PreviewProjection;

public final class ApplyPreviewCompletionHandler {
  private final PreviewProjection projection;

  public ApplyPreviewCompletionHandler(PreviewProjection projection) {
    this.projection = projection;
  }

  public void handle(ApplyPreviewCompletionCommand command) {
    projection.apply(command);
  }
}
