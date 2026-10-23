package vn.editor.identity.auth.domain;

public final class AccountSharingPolicy {
  public static void requireVerifiedEmail(boolean verified) {
    if (!verified)
      throw new AuthenticationFailure(
          AuthenticationFailure.Reason.EMAIL_NOT_VERIFIED,
          "Recipient must verify this email by linking Google before receiving shared documents");
  }

  private AccountSharingPolicy() {}
}
