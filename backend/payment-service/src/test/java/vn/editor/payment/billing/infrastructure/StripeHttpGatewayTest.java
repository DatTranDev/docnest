package vn.editor.payment.billing.infrastructure;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import vn.editor.payment.billing.domain.BillingFailure;

/** Real HTTP adapter contract, not proof of Stripe sandbox billing. */
class StripeHttpGatewayTest {
  @Test
  void postsConfiguredPriceAndStableIdempotencyAndReadsCurrentPaidInvoiceShape() throws Exception {
    UUID user = UUID.randomUUID(), request = UUID.randomUUID();
    var captured = new AtomicReference<String>();
    long expiry = Instant.now().plusSeconds(3600).getEpochSecond();
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/",
        exchange -> {
          assertEquals(
              StripeHttpGateway.API_VERSION,
              exchange.getRequestHeaders().getFirst("Stripe-Version"));
          assertEquals(
              "Bearer sk_test_contract", exchange.getRequestHeaders().getFirst("Authorization"));
          String path = exchange.getRequestURI().getPath(), response;
          if (path.equals("/v1/checkout/sessions")) {
            assertEquals(
                "checkout-" + request, exchange.getRequestHeaders().getFirst("Idempotency-Key"));
            captured.set(
                new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            response =
                "{\"livemode\":false,\"url\":\"https://checkout.stripe.com/c/pay/contract\"}";
          } else if (path.equals("/v1/subscriptions")) {
            assertTrue(exchange.getRequestURI().getRawQuery().contains("customer=cus_contract"));
            response =
                "{\"has_more\":false,\"data\":[{\"id\":\"sub_contract\",\"livemode\":false,\"status\":\"active\",\"cancel_at_period_end\":true,\"metadata\":{\"userId\":\""
                    + user
                    + "\",\"checkoutRequestId\":\""
                    + request
                    + "\"},\"items\":{\"data\":[{\"quantity\":1,\"current_period_end\":"
                    + expiry
                    + ",\"price\":{\"id\":\"price_monthly\"}}]},\"latest_invoice\":{\"status\":\"paid\"}}]}";
          } else response = "{\"id\":\"cus_contract\",\"livemode\":false}";
          byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(200, bytes.length);
          exchange.getResponseBody().write(bytes);
          exchange.close();
        });
    server.start();
    try {
      var gateway =
          new StripeHttpGateway(
              "sk_test_contract",
              "price_monthly",
              "price_yearly",
              "http://localhost:8080",
              URI.create("http://127.0.0.1:" + server.getAddress().getPort()));
      assertTrue(gateway.enabled());
      assertEquals("cus_contract", gateway.customer(user));
      assertEquals(
          "https://checkout.stripe.com/c/pay/contract",
          gateway.checkout(
              request, user, "cus_contract", "PRO_MONTHLY", Instant.ofEpochSecond(expiry)));
      String first = captured.get();
      gateway.checkout(request, user, "cus_contract", "PRO_MONTHLY", Instant.ofEpochSecond(expiry));
      assertEquals(first, captured.get());
      assertTrue(first.contains("line_items%5B0%5D%5Bprice%5D=price_monthly"));
      assertTrue(first.contains("subscription_data%5Bmetadata%5D%5BuserId%5D=" + user));
      var snapshot = gateway.current(user, "cus_contract");
      assertEquals("PRO_MONTHLY", snapshot.plan());
      assertEquals(Instant.ofEpochSecond(expiry), snapshot.expiresAt());
      assertEquals(request, snapshot.checkoutRequestId());
      assertTrue(snapshot.cancelAtPeriodEnd());
    } finally {
      server.stop(0);
    }
  }

  @Test
  void rejectsLiveCredentialsHostileHostedUrlAndTransientHttpFailureWithoutPayloadLogging()
      throws Exception {
    assertThrows(
        IllegalArgumentException.class,
        () ->
            new StripeHttpGateway(
                "sk_live_forbidden",
                "price_month",
                "price_year",
                "http://localhost:8080",
                URI.create("https://api.stripe.com")));
    var response = new AtomicReference<>("{\"url\":\"https://attacker.test/secret\"}");
    var status = new java.util.concurrent.atomic.AtomicInteger(200);
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/",
        exchange -> {
          exchange.getRequestBody().readAllBytes();
          byte[] bytes = response.get().getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(status.get(), bytes.length);
          exchange.getResponseBody().write(bytes);
          exchange.close();
        });
    server.start();
    try {
      var gateway =
          new StripeHttpGateway(
              "sk_test_contract",
              "price_monthly",
              "price_yearly",
              "http://localhost:8080",
              URI.create("http://127.0.0.1:" + server.getAddress().getPort()));
      assertEquals(
          "STRIPE_INVALID_RESPONSE",
          assertThrows(
                  BillingFailure.class, () -> gateway.portal(UUID.randomUUID(), "cus_contract"))
              .getMessage());
      status.set(503);
      response.set("private provider payload");
      assertEquals(
          "STRIPE_UNAVAILABLE",
          assertThrows(BillingFailure.class, () -> gateway.customer(UUID.randomUUID()))
              .getMessage());
      status.set(200);
      response.set("x".repeat(1048577));
      assertEquals(
          "STRIPE_INVALID_RESPONSE",
          assertThrows(BillingFailure.class, () -> gateway.customer(UUID.randomUUID()))
              .getMessage());
      response.set("");
      assertEquals(
          "STRIPE_INVALID_RESPONSE",
          assertThrows(BillingFailure.class, () -> gateway.customer(UUID.randomUUID()))
              .getMessage());
    } finally {
      server.stop(0);
    }
  }
}
