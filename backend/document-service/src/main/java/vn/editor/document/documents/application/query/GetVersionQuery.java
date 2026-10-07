package vn.editor.document.documents.application.query;

import vn.editor.document.shared.domain.Values;

public record GetVersionQuery(String actor, String documentId, long revision) {
  public GetVersionQuery {
    actor = Values.id(actor);
    documentId = Values.id(documentId);
    Values.integer(revision, 1, Values.MAX_SAFE_INTEGER);
  }
}
