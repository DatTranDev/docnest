package vn.editor.document.documents.application.port;

import vn.editor.document.documents.application.command.ApplyPreviewCompletionCommand;

public interface PreviewProjection {
  void apply(ApplyPreviewCompletionCommand command);
}
