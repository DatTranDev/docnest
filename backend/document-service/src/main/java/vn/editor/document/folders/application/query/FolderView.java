package vn.editor.document.folders.application.query;

public record FolderView(
    String id,
    String parentId,
    String name,
    long metadataRevision,
    String createdAt,
    String updatedAt) {}
