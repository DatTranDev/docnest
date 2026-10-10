package vn.editor.payment.billing.api;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import vn.editor.payment.billing.api.dto.CheckoutRequestDto;
import vn.editor.payment.billing.application.command.BillingCommandService;
import vn.editor.payment.billing.application.port.PaymentGateway;
import vn.editor.payment.billing.application.port.StripeSignatures;
import vn.editor.payment.billing.application.query.BillingQueryService;
import vn.editor.payment.billing.domain.BillingFailure;

@RestController
public final class BillingController {
  private final BillingCommandService commands;
  private final BillingQueryService queries;
  private final PaymentGateway gateway;
  private final StripeSignatures signatures;

  public BillingController(
      BillingCommandService commands,
      BillingQueryService queries,
      PaymentGateway gateway,
      StripeSignatures signatures) {
    this.commands = commands;
    this.queries = queries;
    this.gateway = gateway;
    this.signatures = signatures;
  }

  @GetMapping("/api/v1/billing/plans")
  public Map<String, Object> plans() {
    return Map.of(
        "enabled",
        gateway.enabled() && signatures.configured(),
        "testMode",
        true,
        "plans",
        List.of("FREE", "PRO_MONTHLY", "PRO_YEARLY"));
  }

  @GetMapping("/api/v1/billing/subscription")
  public Map<String, Object> subscription(@AuthenticationPrincipal Jwt jwt) {
    return queries.subscription(UUID.fromString(jwt.getSubject()));
  }

  @GetMapping("/api/v1/billing/requests/{id}")
  public Map<String, Object> request(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
    return queries.request(UUID.fromString(jwt.getSubject()), id);
  }

  @PostMapping("/api/v1/billing/checkout")
  public ResponseEntity<?> checkout(
      @AuthenticationPrincipal Jwt jwt,
      @RequestHeader("Idempotency-Key") UUID key,
      @RequestBody CheckoutRequestDto input) {
    return ResponseEntity.accepted()
        .body(commands.request(UUID.fromString(jwt.getSubject()), key, "CHECKOUT", input.plan()));
  }

  @PostMapping("/api/v1/billing/portal")
  public ResponseEntity<?> portal(
      @AuthenticationPrincipal Jwt jwt, @RequestHeader("Idempotency-Key") UUID key) {
    return ResponseEntity.accepted()
        .body(commands.request(UUID.fromString(jwt.getSubject()), key, "PORTAL", "FREE"));
  }

  @PostMapping("/api/v1/billing/cancel")
  public ResponseEntity<?> cancel(
      @AuthenticationPrincipal Jwt jwt, @RequestHeader("Idempotency-Key") UUID key) {
    return ResponseEntity.accepted()
        .body(commands.request(UUID.fromString(jwt.getSubject()), key, "CANCEL", "FREE"));
  }

  @PostMapping("/api/v1/billing/reconcile")
  public ResponseEntity<?> reconcile(
      @AuthenticationPrincipal Jwt jwt, @RequestHeader("Idempotency-Key") UUID key) {
    return ResponseEntity.accepted()
        .body(commands.request(UUID.fromString(jwt.getSubject()), key, "SYNC", "FREE"));
  }

  @PostMapping("/api/v1/billing/webhooks/stripe")
  public ResponseEntity<?> webhook(
      HttpServletRequest request,
      @RequestHeader(value = "Stripe-Signature", required = false) String signature)
      throws IOException {
    var notification = signatures.verify(request.getInputStream().readNBytes(1048577), signature);
    commands.webhook(
        notification.eventId(),
        notification.fingerprint(),
        notification.type(),
        notification.customer());
    return ResponseEntity.ok(Map.of("received", true));
  }

  @ExceptionHandler(BillingFailure.class)
  public ResponseEntity<?> failure(BillingFailure error) {
    int status =
        switch (error.getMessage()) {
          case "STRIPE_NOT_CONFIGURED" -> 503;
          case "BILLING_NOT_FOUND" -> 404;
          case "IDEMPOTENCY_CONFLICT",
              "BILLING_REVIEW_REQUIRED",
              "SUBSCRIPTION_EXISTS",
              "CHECKOUT_IN_PROGRESS",
              "NO_SUBSCRIPTION",
              "WEBHOOK_ID_CONFLICT" ->
              409;
          case "BILLING_QUEUE_LIMIT" -> 429;
          default -> 400;
        };
    return ResponseEntity.status(status)
        .body(
            Map.of("code", error.getMessage(), "message", error.getMessage(), "details", Map.of()));
  }

  @ExceptionHandler({
    HttpMessageNotReadableException.class,
    MethodArgumentTypeMismatchException.class,
    MissingRequestHeaderException.class
  })
  public ResponseEntity<?> invalidRequest() {
    return failure(new BillingFailure("INVALID_BILLING_REQUEST"));
  }
}
