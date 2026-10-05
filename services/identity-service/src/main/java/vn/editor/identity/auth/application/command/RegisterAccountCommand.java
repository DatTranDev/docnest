package vn.editor.identity.auth.application.command;

public record RegisterAccountCommand(String email, String password, String displayName) {}
