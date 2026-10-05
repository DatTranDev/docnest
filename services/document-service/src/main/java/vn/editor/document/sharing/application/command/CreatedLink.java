package vn.editor.document.sharing.application.command;

import vn.editor.document.sharing.application.query.LinkView;

public record CreatedLink(LinkView link, String token, String viewerPath) {}
