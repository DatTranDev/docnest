package vn.editor.identity.auth.application.port;

import vn.editor.identity.auth.domain.AccountEmail;

public record GoogleIdentity(
    String subject, AccountEmail email, String displayName, String pictureUrl) {}
