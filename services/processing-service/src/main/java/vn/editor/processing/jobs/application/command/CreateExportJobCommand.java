package vn.editor.processing.jobs.application.command;

public record CreateExportJobCommand(
    String actor,
    String token,
    String idempotencyKey,
    String documentId,
    long revision,
    String type) {}
