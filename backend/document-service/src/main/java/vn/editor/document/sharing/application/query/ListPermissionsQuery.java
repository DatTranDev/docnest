package vn.editor.document.sharing.application.query;

import vn.editor.document.shared.domain.Values;

public record ListPermissionsQuery(
    String actor, String documentId, String authorization, String cursor, int limit) {
  public ListPermissionsQuery {
    actor = Values.id(actor);
    documentId = Values.id(documentId);
    Values.integer(limit, 1, 100);
  }
}
