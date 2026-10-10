package vn.editor.document.documents.application.command;

import java.io.IOException;

public interface SaveDocumentCommandService {
  SaveResult handle(SaveDocumentCommand command) throws IOException;
}
