package vn.editor.document.documents.application.query;

public record VersionView(
    String id,
    String documentId,
    long revision,
    String nativeSha256,
    long nativeBytes,
    long textUtf8Bytes,
    long utf16Length,
    long logicalLines,
    String createdByUserId,
    String createdAt) {}
