package vn.editor.processing.jobs.application.query;

public record JobView(
    String id,
    String documentId,
    long revision,
    String type,
    String state,
    int attempts,
    String createdAt,
    String finishedAt,
    String errorCode) {}
