package vn.editor.identity.auth.application.port;

public interface GoogleIdentityVerifier {
  GoogleIdentity verify(String credential);
}
