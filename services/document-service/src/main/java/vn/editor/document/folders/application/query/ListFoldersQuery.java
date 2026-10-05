package vn.editor.document.folders.application.query;

import vn.editor.document.shared.domain.Values;

public record ListFoldersQuery(String actor, String parent, String cursor, int limit) {
  public ListFoldersQuery {
    actor = Values.id(actor);
    Values.integer(limit, 1, 100);
  }
}
