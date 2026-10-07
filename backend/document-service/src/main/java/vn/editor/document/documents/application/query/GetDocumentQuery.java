package vn.editor.document.documents.application.query;

import vn.editor.document.shared.domain.Values;

public record GetDocumentQuery(String actor, String documentId) {
  public GetDocumentQuery {
    actor = Values.id(actor);
    documentId = Values.id(documentId);
  }
}
