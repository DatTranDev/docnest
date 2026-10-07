package vn.editor.identity.bootstrap;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import vn.editor.identity.auth.infrastructure.security.AuthCsrfFilter;
import vn.editor.identity.auth.infrastructure.security.TokenKeys;

@Configuration
public class IdentitySecurity {
  @Bean
  public Argon2PasswordEncoder passwords() {
    return new Argon2PasswordEncoder(16, 32, 1, 19456, 2);
  }

  @Bean
  public JwtDecoder jwtDecoder(TokenKeys keys, @Value("${editor.jwt.issuer}") String issuer) {
    NimbusJwtDecoder decoder =
        NimbusJwtDecoder.withPublicKey(keys.publicKey())
            .signatureAlgorithm(SignatureAlgorithm.RS256)
            .build();
    decoder.setJwtValidator(
        new DelegatingOAuth2TokenValidator<>(
            JwtValidators.createDefaultWithIssuer(issuer),
            (Jwt jwt) ->
                jwt.getAudience().contains("editor-api")
                    ? OAuth2TokenValidatorResult.success()
                    : OAuth2TokenValidatorResult.failure(
                        new OAuth2Error("invalid_token", "Invalid audience", null))));
    return decoder;
  }

  @Bean
  public SecurityFilterChain security(HttpSecurity http, AuthCsrfFilter csrf) throws Exception {
    return http.csrf(config -> config.disable())
        .sessionManagement(
            session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(
            auth ->
                auth.requestMatchers(
                        "/api/v1/auth/csrf",
                        "/api/v1/auth/register",
                        "/api/v1/auth/login",
                        "/api/v1/auth/refresh",
                        "/api/v1/auth/logout",
                        "/.well-known/jwks.json",
                        "/actuator/health/**")
                    .permitAll()
                    .anyRequest()
                    .authenticated())
        .oauth2ResourceServer(resource -> resource.jwt(jwt -> {}))
        .addFilterBefore(csrf, UsernamePasswordAuthenticationFilter.class)
        .build();
  }
}
