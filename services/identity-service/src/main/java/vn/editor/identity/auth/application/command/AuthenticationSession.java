package vn.editor.identity.auth.application.command;

import java.time.Instant;
import vn.editor.identity.auth.application.query.UserView;

public record AuthenticationSession(
    String accessToken, String refreshToken, UserView user, Instant expiresAt) {}
