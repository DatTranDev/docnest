package vn.editor.identity.auth.application.query;

public record ResolveAccountQuery(String value, String callerKey, boolean byEmail) {}
