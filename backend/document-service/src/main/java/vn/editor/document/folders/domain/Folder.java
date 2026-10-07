package vn.editor.document.folders.domain;

import vn.editor.document.shared.domain.Values;

public record Folder(String id, String owner, String parentId, String name, long metadataRevision) {
  public Folder {
    Values.id(id);
    Values.id(owner);
    parentId = Values.nullableId(parentId);
    name = Values.name(name, 120);
    Values.integer(metadataRevision, 1, Values.MAX_SAFE_INTEGER);
  }

  public Folder move(long expected, String name, String parent) {
    Values.metadataRevision(metadataRevision, expected);
    return new Folder(id, owner, parent, name == null ? this.name : name, metadataRevision + 1);
  }

  public void requireRevision(long expected) {
    Values.metadataRevision(metadataRevision, expected);
  }
}
