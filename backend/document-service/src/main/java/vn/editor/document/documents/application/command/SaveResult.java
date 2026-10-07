package vn.editor.document.documents.application.command;

import java.util.Map;

public record SaveResult(int status, Map<String, Object> body) {}
