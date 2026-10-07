package vn.editor.document.documents.application.command;

import java.util.Map;

public record UploadView(
    String uploadId,
    String kind,
    String uploadUrl,
    String method,
    Map<String, String> requiredHeaders,
    String commitDeadlineAt) {}
