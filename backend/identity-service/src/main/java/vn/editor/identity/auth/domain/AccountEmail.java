package vn.editor.identity.auth.domain;

import java.util.Locale;

public record AccountEmail(String value) {
  public AccountEmail {
    if (value == null
        || value.length() > 254
        || !value.matches(
            "[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\\.[A-Za-z]{2,}"))
      throw new AuthenticationFailure(
          AuthenticationFailure.Reason.INVALID_EMAIL, "Enter a valid ASCII email address");
    value = value.toLowerCase(Locale.ROOT);
  }
}
