package vn.editor.processing.jobs.application.query;

import java.util.List;

public record JobPage(List<JobView> items, String nextCursor) {}
