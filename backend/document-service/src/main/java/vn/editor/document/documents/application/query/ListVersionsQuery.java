package vn.editor.document.documents.application.query;

import vn.editor.document.shared.domain.Values;

public record ListVersionsQuery(String actor, String documentId, String cursor, int limit) {
  public ListVersionsQuery {
    actor = Values.id(actor);
    documentId = Values.id(documentId);
    Values.integer(limit, 1, 100);
  }
}
