package vn.editor.processing.jobs.application.command;

public record CancelExportJobCommand(String actor, String token, String jobId) {}
