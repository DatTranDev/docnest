package vn.editor.identity.auth.domain;

public final class RegistrationPolicy {
  public static final int MIN_PASSWORD_CODE_POINTS = 12,
      MAX_PASSWORD_CODE_POINTS = 128,
      MAX_DISPLAY_NAME_CODE_POINTS = 100;

  public static void validatePassword(String password, boolean registration) {
    int minimum = registration ? MIN_PASSWORD_CODE_POINTS : 1;
    if (password == null
        || password.codePointCount(0, password.length()) < minimum
        || password.codePointCount(0, password.length()) > MAX_PASSWORD_CODE_POINTS)
      throw new AuthenticationFailure(
          AuthenticationFailure.Reason.INVALID_PASSWORD, "Password length is invalid");
  }

  public static void validateDisplayName(String name) {
    if (name == null
        || name.isBlank()
        || name.codePointCount(0, name.length()) > MAX_DISPLAY_NAME_CODE_POINTS)
      throw new AuthenticationFailure(
          AuthenticationFailure.Reason.INVALID_DISPLAY_NAME,
          "Display name must contain 1 to 100 code points");
  }

  public static void requireCapacity(boolean emailExists, long accounts, int maximum) {
    if (emailExists)
      throw new AuthenticationFailure(
          AuthenticationFailure.Reason.EMAIL_ALREADY_REGISTERED, "Email is already registered");
    if (accounts >= maximum)
      throw new AuthenticationFailure(
          AuthenticationFailure.Reason.ACCOUNT_QUOTA, "Account quota reached");
  }

  private RegistrationPolicy() {}
}
