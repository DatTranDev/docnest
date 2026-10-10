package vn.editor.document.documents.application.command;

import vn.editor.document.documents.application.query.DocumentView;

public interface DocumentCommandService {
  DocumentView handle(CreateDocumentCommand command);

  DocumentView handle(ChangeDocumentMetadataCommand command);

  DocumentView handle(TrashDocumentCommand command);
}
