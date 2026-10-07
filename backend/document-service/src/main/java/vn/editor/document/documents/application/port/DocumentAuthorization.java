package vn.editor.document.documents.application.port;

import vn.editor.document.documents.domain.Document;

/**
 * Cross-feature authorization capability; lock=true participates in the caller's short SQL
 * transaction.
 */
public interface DocumentAuthorization {
  Document authorize(String actor, String documentId, boolean lock, boolean allowTrash);

  void requireOwner(String actor, String documentId, boolean lock, boolean allowTrash);
}
