package vn.editor.identity.auth.infrastructure.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.stereotype.Component;
import vn.editor.identity.auth.application.port.GoogleIdentity;
import vn.editor.identity.auth.application.port.GoogleIdentityVerifier;
import vn.editor.identity.auth.domain.AccountEmail;
import vn.editor.identity.auth.domain.AuthenticationFailure;

@Component
public final class GoogleJwtIdentityVerifier implements GoogleIdentityVerifier {
  private final String clientId;
  private final JwtDecoder decoder;

  public GoogleJwtIdentityVerifier(@Value("${editor.auth.google-client-id:}") String clientId) {
    this.clientId = clientId;
    NimbusJwtDecoder google =
        NimbusJwtDecoder.withJwkSetUri("https://www.googleapis.com/oauth2/v3/certs")
            .jwsAlgorithm(SignatureAlgorithm.RS256)
            .build();
    google.setJwtValidator(JwtValidators.createDefaultWithIssuer("https://accounts.google.com"));
    this.decoder = google;
  }

  @Override
  public GoogleIdentity verify(String credential) {
    if (clientId.isBlank() || credential == null || credential.length() > 8192)
      throw AuthenticationFailure.credentials();
    final Jwt token;
    try {
      token = decoder.decode(credential);
    } catch (JwtException invalid) {
      throw AuthenticationFailure.credentials();
    }
    if (!token.getAudience().contains(clientId)
        || !Boolean.TRUE.equals(token.getClaim("email_verified"))
        || token.getSubject() == null
        || token.getSubject().isBlank()) throw AuthenticationFailure.credentials();
    return new GoogleIdentity(
        token.getSubject(),
        new AccountEmail(token.getClaimAsString("email")),
        token.getClaimAsString("name"));
  }
}
