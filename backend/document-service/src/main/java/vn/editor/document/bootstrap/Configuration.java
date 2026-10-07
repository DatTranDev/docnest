package vn.editor.document.bootstrap;

import java.io.IOException;
import java.nio.file.Path;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import vn.editor.common.observability.TraceContext;
import vn.editor.common.storage.GcsStorage;
import vn.editor.common.storage.LocalStorage;
import vn.editor.common.storage.StorageProvider;

@org.springframework.context.annotation.Configuration
public class Configuration {
  @Bean
  org.springframework.kafka.support.ProducerListener<Object, Object> redactedProducerListener() {
    return new org.springframework.kafka.support.ProducerListener<>() {};
  }

  @Bean
  org.springframework.kafka.listener.DefaultErrorHandler durableConsumerErrorHandler() {
    var handler =
        new org.springframework.kafka.listener.DefaultErrorHandler(
            (record, error) -> {
              throw new org.springframework.kafka.KafkaException("DLQ_UNAVAILABLE");
            },
            new org.springframework.util.backoff.FixedBackOff(
                1000, org.springframework.util.backoff.FixedBackOff.UNLIMITED_ATTEMPTS));
    handler.setAckAfterHandle(false);
    handler.setCommitRecovered(false);
    return handler;
  }

  @Bean
  StorageProvider storage(
      @Value("${editor.storage.provider:LOCAL}") String provider,
      @Value("${editor.storage.root:./data/objects}") String root,
      @Value("${editor.public-base-url:http://localhost:8080}") String base,
      @Value("${editor.storage.bucket:}") String bucket,
      @Value("${editor.web-origin:http://localhost:8080}") String origin)
      throws IOException {
    return provider.equals("GCS")
        ? new GcsStorage(bucket, origin)
        : new LocalStorage(Path.of(root), base);
  }

  @Bean
  JwtDecoder decoder(
      @Value("${editor.jwt.jwk-uri:http://localhost:8081/.well-known/jwks.json}") String uri,
      @Value("${editor.jwt.issuer:http://identity-service:8080}") String issuer) {
    NimbusJwtDecoder decoder =
        NimbusJwtDecoder.withJwkSetUri(uri)
            .jwsAlgorithm(org.springframework.security.oauth2.jose.jws.SignatureAlgorithm.RS256)
            .build();
    decoder.setJwtValidator(
        new org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator<>(
            JwtValidators.createDefaultWithIssuer(issuer),
            jwt ->
                jwt.getAudience().contains("editor-api")
                    ? OAuth2TokenValidatorResult.success()
                    : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token"))));
    return decoder;
  }

  @Bean
  SecurityFilterChain security(HttpSecurity http) throws Exception {
    return http.csrf(c -> c.disable())
        .sessionManagement(
            s ->
                s.sessionCreationPolicy(
                    org.springframework.security.config.http.SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(
            a ->
                a.requestMatchers("/actuator/health/**", "/api/v1/public/**")
                    .permitAll()
                    .anyRequest()
                    .authenticated())
        .oauth2ResourceServer(
            o ->
                o.jwt(j -> {})
                    .authenticationEntryPoint(
                        (r, s, e) -> {
                          s.setStatus(401);
                          s.setContentType("application/json");
                          s.getWriter()
                              .write(
                                  "{\"code\":\"UNAUTHORIZED\",\"message\":\"Authentication"
                                      + " required\",\"traceId\":\""
                                      + TraceContext.traceId()
                                      + "\"}");
                        }))
        .build();
  }
}
