package vn.editor.processing.jobs.application.port;

/** Exact server-issued generation reference and hash obtained before the SQL transaction. */
public record SourceSnapshot(String referenceJson, String nativeSha256) {}
