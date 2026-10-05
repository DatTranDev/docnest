package vn.editor.processing.bootstrap;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Path;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import vn.editor.common.storage.GcsStorage;
import vn.editor.common.storage.LocalStorage;
import vn.editor.common.storage.StorageProvider;
import vn.editor.processing.jobs.infrastructure.ProcessingStorage;

@Configuration
public class ProcessingConfig {
  @Bean
  ObjectMapper processingJson() {
    return new ObjectMapper();
  }

  @Bean
  StorageProvider storage(
      @Value("${editor.storage.provider}") String provider,
      @Value("${editor.storage.root}") String root,
      @Value("${editor.storage.bucket}") String bucket,
      @Value("${editor.storage.snapshots-bucket}") String snapshots,
      @Value("${editor.storage.origin}") String origin,
      @Value("${editor.public-base-url}") String base)
      throws java.io.IOException {
    return provider.equals("GCS")
        ? new ProcessingStorage(new GcsStorage(snapshots, origin), new GcsStorage(bucket, origin))
        : new LocalStorage(Path.of(root), base);
  }

  @Bean
  JwtDecoder jwtDecoder(
      @Value("${editor.jwt.issuer}") String issuer, @Value("${editor.jwt.jwk-uri}") String uri) {
    NimbusJwtDecoder decoder =
        NimbusJwtDecoder.withJwkSetUri(uri).jwsAlgorithm(SignatureAlgorithm.RS256).build();
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
  SecurityFilterChain security(HttpSecurity http) throws Exception {
    return http.csrf(c -> c.disable())
        .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(
            a -> a.requestMatchers("/actuator/health/**").permitAll().anyRequest().authenticated())
        .oauth2ResourceServer(o -> o.jwt(j -> {}))
        .build();
  }
}
