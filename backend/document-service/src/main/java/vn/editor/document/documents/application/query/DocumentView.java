package vn.editor.document.documents.application.query;

import java.util.Map;

public record DocumentView(
    String id,
    String ownerUserId,
    String folderId,
    String title,
    long headRevision,
    String headVersionId,
    long metadataRevision,
    String effectiveRole,
    String createdAt,
    String updatedAt,
    String deletedAt,
    Long sizeBytes,
    Map<String, Object> preview) {}
