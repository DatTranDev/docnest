package vn.editor.payment.billing.infrastructure;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import vn.editor.payment.billing.application.port.PaymentGateway;
import vn.editor.payment.billing.domain.BillingFailure;

@Component
public final class StripeHttpGateway implements PaymentGateway {
  public static final String API_VERSION = "2026-09-30.endive";
  private final HttpClient client =
      HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
  private final ObjectMapper json = new ObjectMapper();
  private final String key;
  private final String monthly;
  private final String yearly;
  private final String origin;
  private final URI api;

  @Autowired
  public StripeHttpGateway(
      @Value("${editor.stripe.secret-key}") String key,
      @Value("${editor.stripe.monthly-price}") String monthly,
      @Value("${editor.stripe.yearly-price}") String yearly,
      @Value("${editor.stripe.public-origin}") String origin) {
    this(key, monthly, yearly, origin, URI.create("https://api.stripe.com"));
  }

  // Package-private test seam for HTTP contract tests; production endpoint is never
  // user-configurable.
  StripeHttpGateway(String key, String monthly, String yearly, String origin, URI api) {
    if (!key.isEmpty() && !key.startsWith("sk_test_"))
      throw new IllegalArgumentException("STRIPE_TEST_KEY_REQUIRED");
    URI publicUri = URI.create(origin);
    if (!java.util.Set.of("http", "https").contains(publicUri.getScheme())
        || publicUri.getHost() == null
        || publicUri.getUserInfo() != null
        || publicUri.getQuery() != null
        || publicUri.getFragment() != null
        || !(publicUri.getPath().isEmpty() || publicUri.getPath().equals("/")))
      throw new IllegalArgumentException("INVALID_BILLING_ORIGIN");
    this.key = key;
    this.monthly = monthly;
    this.yearly = yearly;
    this.origin = origin.replaceAll("/$", "");
    this.api = api;
  }

  @Override
  public boolean enabled() {
    return !key.isEmpty()
        && monthly.matches("price_[A-Za-z0-9]+")
        && yearly.matches("price_[A-Za-z0-9]+")
        && !monthly.equals(yearly);
  }

  @Override
  public String customer(UUID userId) {
    JsonNode result =
        call(
            "POST",
            "/v1/customers",
            Map.of("metadata[userId]", userId.toString()),
            "customer-" + userId);
    requireTest(result);
    return identifier(result.path("id").asText(), "cus_");
  }

  @Override
  public String checkout(UUID id, UUID userId, String customer, String plan, Instant expiresAt) {
    String price =
        switch (plan) {
          case "PRO_MONTHLY" -> monthly;
          case "PRO_YEARLY" -> yearly;
          default -> throw new BillingFailure("INVALID_PLAN");
        };
    Map<String, String> fields = new HashMap<>();
    fields.put("mode", "subscription");
    fields.put("customer", identifier(customer, "cus_"));
    fields.put("line_items[0][price]", price);
    fields.put("line_items[0][quantity]", "1");
    fields.put("success_url", origin + "/?billing=success");
    fields.put("cancel_url", origin + "/?billing=cancelled");
    fields.put("client_reference_id", userId.toString());
    fields.put("subscription_data[metadata][userId]", userId.toString());
    fields.put("subscription_data[metadata][checkoutRequestId]", id.toString());
    fields.put("expires_at", Long.toString(expiresAt.getEpochSecond()));
    JsonNode result = call("POST", "/v1/checkout/sessions", fields, "checkout-" + id);
    requireTest(result);
    return hostedUrl(result.path("url").asText(), "checkout.stripe.com");
  }

  @Override
  public String portal(UUID id, String customer) {
    return hostedUrl(
        call(
                "POST",
                "/v1/billing_portal/sessions",
                Map.of(
                    "customer",
                    identifier(customer, "cus_"),
                    "return_url",
                    origin + "/?billing=portal"),
                "portal-" + id)
            .path("url")
            .asText(),
        "billing.stripe.com");
  }

  @Override
  public void cancel(UUID id, String subscriptionId) {
    var response =
        call(
            "POST",
            "/v1/subscriptions/" + identifier(subscriptionId, "sub_"),
            Map.of("cancel_at_period_end", "true"),
            "cancel-" + id);
    requireTest(response);
    if (!subscriptionId.equals(response.path("id").asText())
        || !response.path("cancel_at_period_end").asBoolean())
      throw new BillingFailure("STRIPE_INVALID_RESPONSE");
  }

  @Override
  public Snapshot current(UUID userId, String customer) {
    JsonNode listing =
        call(
            "GET",
            "/v1/subscriptions",
            Map.of(
                "customer",
                identifier(customer, "cus_"),
                "status",
                "all",
                "limit",
                "100",
                "expand[]",
                "data.latest_invoice"),
            null);
    if (!listing.path("data").isArray() || listing.path("has_more").asBoolean())
      throw new BillingFailure("STRIPE_REVIEW_REQUIRED");
    Snapshot selected = null;
    for (JsonNode subscription : listing.path("data")) {
      requireTest(subscription);
      if (!userId.toString().equals(subscription.path("metadata").path("userId").asText()))
        continue;
      String status = subscription.path("status").asText();
      if (java.util.Set.of("canceled", "incomplete_expired").contains(status)) continue;
      if (selected != null) throw new BillingFailure("STRIPE_REVIEW_REQUIRED");
      var items = subscription.path("items").path("data");
      if (!items.isArray() || items.size() != 1 || items.get(0).path("quantity").asInt() != 1)
        throw new BillingFailure("STRIPE_REVIEW_REQUIRED");
      var item = items.get(0);
      String price = item.path("price").path("id").asText();
      String configuredPlan =
          price.equals(monthly) ? "PRO_MONTHLY" : price.equals(yearly) ? "PRO_YEARLY" : null;
      if (configuredPlan == null) throw new BillingFailure("STRIPE_REVIEW_REQUIRED");
      UUID checkout;
      try {
        checkout =
            UUID.fromString(subscription.path("metadata").path("checkoutRequestId").asText());
      } catch (IllegalArgumentException invalid) {
        throw new BillingFailure("STRIPE_REVIEW_REQUIRED");
      }
      var invoice = subscription.path("latest_invoice");
      if (invoice.isTextual())
        invoice =
            call("GET", "/v1/invoices/" + identifier(invoice.asText(), "in_"), Map.of(), null);
      boolean paid = status.equals("active") && invoice.path("status").asText().equals("paid");
      long end = item.path("current_period_end").asLong();
      Instant expires = end > 0 ? Instant.ofEpochSecond(end) : null;
      String plan =
          paid && expires != null && expires.isAfter(Instant.now()) ? configuredPlan : "FREE";
      selected =
          new Snapshot(
              identifier(subscription.path("id").asText(), "sub_"),
              plan,
              plan.equals("FREE") ? null : expires,
              status,
              subscription.path("cancel_at_period_end").asBoolean(),
              checkout);
    }
    return selected == null ? new Snapshot(null, "FREE", null, "none", false, null) : selected;
  }

  private JsonNode call(
      String method, String path, Map<String, String> fields, String idempotency) {
    if (!enabled()) throw new BillingFailure("STRIPE_NOT_CONFIGURED");
    String form =
        fields.entrySet().stream()
            .sorted(Map.Entry.comparingByKey())
            .map(e -> encode(e.getKey()) + "=" + encode(e.getValue()))
            .collect(java.util.stream.Collectors.joining("&"));
    var request =
        HttpRequest.newBuilder(
                api.resolve(path + (method.equals("GET") && !form.isEmpty() ? "?" + form : "")))
            .timeout(Duration.ofSeconds(30))
            .header("Authorization", "Bearer " + key)
            .header("Stripe-Version", API_VERSION);
    if (idempotency != null) request.header("Idempotency-Key", idempotency);
    if (method.equals("GET")) request.GET();
    else
      request
          .header("Content-Type", "application/x-www-form-urlencoded")
          .POST(HttpRequest.BodyPublishers.ofString(form));
    var pending = client.sendAsync(request.build(), info -> new BoundedBody());
    try {
      var response = pending.get(30, java.util.concurrent.TimeUnit.SECONDS);
      if (response.statusCode() == 429
          || response.statusCode() == 409
          || response.statusCode() >= 500) throw new BillingFailure("STRIPE_UNAVAILABLE");
      if (response.statusCode() / 100 != 2) throw new BillingFailure("STRIPE_REQUEST_REJECTED");
      var object = json.readTree(response.body());
      if (object == null || !object.isObject()) throw new BillingFailure("STRIPE_INVALID_RESPONSE");
      return object;
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      throw new BillingFailure("STRIPE_UNAVAILABLE");
    } catch (java.util.concurrent.ExecutionException unavailable) {
      if (unavailable.getCause() instanceof BillingFailure failure) throw failure;
      throw new BillingFailure("STRIPE_UNAVAILABLE");
    } catch (java.util.concurrent.TimeoutException unavailable) {
      throw new BillingFailure("STRIPE_UNAVAILABLE");
    } catch (IOException invalid) {
      throw new BillingFailure("STRIPE_INVALID_RESPONSE");
    } finally {
      pending.cancel(true);
    }
  }

  /** Bounds residency before buffering and includes body receipt in the overall deadline. */
  private static final class BoundedBody implements HttpResponse.BodySubscriber<byte[]> {
    private final java.util.concurrent.CompletableFuture<byte[]> result =
        new java.util.concurrent.CompletableFuture<>();
    private final java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
    private java.util.concurrent.Flow.Subscription subscription;

    @Override
    public java.util.concurrent.CompletionStage<byte[]> getBody() {
      return result;
    }

    @Override
    public void onSubscribe(java.util.concurrent.Flow.Subscription value) {
      subscription = value;
      value.request(1);
    }

    @Override
    public void onNext(java.util.List<java.nio.ByteBuffer> buffers) {
      for (java.nio.ByteBuffer buffer : buffers) {
        if (buffer.remaining() > 1048576 - bytes.size()) {
          subscription.cancel();
          result.completeExceptionally(new BillingFailure("STRIPE_INVALID_RESPONSE"));
          return;
        }
        byte[] chunk = new byte[buffer.remaining()];
        buffer.get(chunk);
        bytes.writeBytes(chunk);
      }
      subscription.request(1);
    }

    @Override
    public void onError(Throwable error) {
      result.completeExceptionally(error);
    }

    @Override
    public void onComplete() {
      result.complete(bytes.toByteArray());
    }
  }

  private static String encode(String value) {
    return URLEncoder.encode(value, StandardCharsets.UTF_8);
  }

  private static String identifier(String value, String prefix) {
    if (value == null || !value.matches(prefix + "[A-Za-z0-9]{1,120}"))
      throw new BillingFailure("STRIPE_INVALID_RESPONSE");
    return value;
  }

  private static void requireTest(JsonNode object) {
    if (!object.path("livemode").isBoolean() || object.path("livemode").asBoolean())
      throw new BillingFailure("STRIPE_TEST_MODE_REQUIRED");
  }

  private static String hostedUrl(String value, String host) {
    URI uri;
    try {
      uri = URI.create(value);
    } catch (IllegalArgumentException invalid) {
      throw new BillingFailure("STRIPE_INVALID_RESPONSE");
    }
    if (!"https".equals(uri.getScheme())
        || !host.equals(uri.getHost())
        || uri.getUserInfo() != null
        || (uri.getPort() != -1 && uri.getPort() != 443))
      throw new BillingFailure("STRIPE_INVALID_RESPONSE");
    return value;
  }
}
