package vn.editor.identity.auth.application.query;

import vn.editor.identity.auth.application.port.CsrfTokens;

public final class IssueCsrfHandler implements IssueCsrfService {
  private final CsrfTokens tokens;

  public IssueCsrfHandler(CsrfTokens tokens) {
    this.tokens = tokens;
  }

  public String handle() {
    return tokens.issue();
  }
}
