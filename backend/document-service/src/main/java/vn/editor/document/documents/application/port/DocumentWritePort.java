package vn.editor.document.documents.application.port;

import java.util.function.Supplier;
import vn.editor.document.documents.application.query.DocumentView;
import vn.editor.document.documents.domain.Document;

public interface DocumentWritePort {
  <T> T execute(Supplier<T> action);

  Document load(String actor, String documentId, boolean allowTrash);

  long count(String actor);

  int maximum();

  void insert(String actor, String documentId, String title, String folder);

  void updateMetadata(Document document);

  void markTrash(String documentId);

  void restore(String documentId, String folder);

  DocumentView view(String actor, String documentId);
}
