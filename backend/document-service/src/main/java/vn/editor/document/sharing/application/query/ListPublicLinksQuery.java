package vn.editor.document.sharing.application.query;

import vn.editor.document.shared.domain.Values;

public record ListPublicLinksQuery(String actor, String documentId, String cursor, int limit) {
  public ListPublicLinksQuery {
    actor = Values.id(actor);
    documentId = Values.id(documentId);
    Values.integer(limit, 1, 100);
  }
}
