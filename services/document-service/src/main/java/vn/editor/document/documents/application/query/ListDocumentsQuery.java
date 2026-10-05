package vn.editor.document.documents.application.query;

import java.util.Set;
import vn.editor.document.shared.domain.DomainException;
import vn.editor.document.shared.domain.Values;

public record ListDocumentsQuery(
    String actor, String scope, String parent, String titleQuery, String cursor, int limit) {
  public ListDocumentsQuery {
    actor = Values.id(actor);
    Values.integer(limit, 1, 100);
    if (!Set.of("OWNED", "SHARED", "TRASH").contains(scope)
        || titleQuery != null && titleQuery.codePointCount(0, titleQuery.length()) > 200)
      throw new DomainException(400, "INVALID_REQUEST");
  }
}
