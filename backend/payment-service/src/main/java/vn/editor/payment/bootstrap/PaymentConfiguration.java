package vn.editor.payment.bootstrap;

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
import vn.editor.payment.billing.application.command.BillingCommandHandler;
import vn.editor.payment.billing.application.command.RunBillingWorkHandler;
import vn.editor.payment.billing.application.port.PaymentGateway;
import vn.editor.payment.billing.application.port.PaymentRepository;
import vn.editor.payment.billing.application.port.StripeSignatures;
import vn.editor.payment.billing.application.query.BillingQueryHandler;

@Configuration
public class PaymentConfiguration {
  @Bean
  BillingCommandHandler billingCommands(
      PaymentRepository store, PaymentGateway gateway, StripeSignatures signatures) {
    return new BillingCommandHandler(store, gateway, signatures);
  }

  @Bean
  BillingQueryHandler billingQueries(PaymentRepository store) {
    return new BillingQueryHandler(store);
  }

  @Bean
  RunBillingWorkHandler billingWork(PaymentRepository store, PaymentGateway gateway) {
    return new RunBillingWorkHandler(store, gateway);
  }

  @Bean
  JwtDecoder jwtDecoder(
      @Value("${editor.jwt.issuer}") String issuer, @Value("${editor.jwt.jwk-uri}") String uri) {
    var decoder =
        NimbusJwtDecoder.withJwkSetUri(uri).jwsAlgorithm(SignatureAlgorithm.RS256).build();
    decoder.setJwtValidator(
        new DelegatingOAuth2TokenValidator<>(
            JwtValidators.createDefaultWithIssuer(issuer),
            (Jwt jwt) ->
                jwt.getAudience().contains("editor-api")
                    ? OAuth2TokenValidatorResult.success()
                    : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token"))));
    return decoder;
  }

  @Bean
  SecurityFilterChain security(HttpSecurity http) throws Exception {
    return http.csrf(c -> c.disable())
        .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .headers(h -> h.cacheControl(c -> {}))
        .authorizeHttpRequests(
            a ->
                a.requestMatchers(
                        "/actuator/health/**",
                        "/api/v1/billing/plans",
                        "/api/v1/billing/webhooks/stripe")
                    .permitAll()
                    .requestMatchers("/api/v1/billing/**")
                    .authenticated()
                    .anyRequest()
                    .denyAll())
        .oauth2ResourceServer(o -> o.jwt(j -> {}))
        .build();
  }
}
