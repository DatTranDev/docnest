package vn.editor.processing.jobs.application.query;

public record ListJobsQuery(String actor, String token, int limit, String cursor) {}
