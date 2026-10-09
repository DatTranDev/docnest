package vn.editor.payment.billing.infrastructure;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.util.HexFormat;
import java.util.Set;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import vn.editor.common.messaging.JdbcMessageLog;
import vn.editor.payment.billing.application.port.StripeSignatures;
import vn.editor.payment.billing.domain.BillingFailure;

@Component
public final class StripeWebhookVerifier implements StripeSignatures {
  @Override
  public boolean configured() {
    return secret.startsWith("whsec_") && secret.length() >= 14 && secret.length() <= 256;
  }

  private final String secret;
  private final Clock clock;
  private final ObjectMapper json = new ObjectMapper();
  private static final Set<String> TYPES =
      Set.of(
          "checkout.session.completed",
          "checkout.session.async_payment_succeeded",
          "checkout.session.async_payment_failed",
          "customer.subscription.created",
          "customer.subscription.updated",
          "customer.subscription.deleted",
          "invoice.paid",
          "invoice.payment_failed",
          "invoice.payment_action_required");

  @Autowired
  public StripeWebhookVerifier(@Value("${editor.stripe.webhook-secret}") String secret) {
    this(secret, Clock.systemUTC());
  }

  StripeWebhookVerifier(String secret, Clock clock) {
    this.secret = secret;
    this.clock = clock;
  }

  @Override
  public Notification verify(byte[] bytes, String header) {
    if (!configured()) throw new BillingFailure("STRIPE_NOT_CONFIGURED");
    if (bytes.length == 0 || bytes.length > 1048576 || header == null || header.length() > 2048)
      throw new BillingFailure("INVALID_STRIPE_SIGNATURE");
    long timestamp = -1;
    var signatures = new java.util.ArrayList<String>();
    try {
      for (String part : header.split(",")) {
        String[] field = part.trim().split("=", 2);
        if (field.length != 2) continue;
        if (field[0].equals("t")) {
          if (timestamp != -1) throw new BillingFailure("INVALID_STRIPE_SIGNATURE");
          timestamp = Long.parseLong(field[1]);
        }
        if (field[0].equals("v1") && field[1].matches("[a-f0-9]{64}")) signatures.add(field[1]);
      }
      long now = clock.instant().getEpochSecond();
      if (timestamp < now - 300 || timestamp > now + 300)
        throw new BillingFailure("INVALID_STRIPE_SIGNATURE");
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
      mac.update((timestamp + ".").getBytes(StandardCharsets.US_ASCII));
      byte[] digest = mac.doFinal(bytes);
      boolean matched = false;
      for (String signature : signatures)
        matched |= MessageDigest.isEqual(digest, HexFormat.of().parseHex(signature));
      if (!matched) throw new BillingFailure("INVALID_STRIPE_SIGNATURE");
      var event = json.readTree(bytes);
      String id = event.path("id").asText(), type = event.path("type").asText();
      if (!id.matches("evt_[A-Za-z0-9]{1,120}")
          || !type.matches("[a-z_.]{1,64}")
          || !event.path("livemode").isBoolean()
          || event.path("livemode").asBoolean()) throw new BillingFailure("INVALID_STRIPE_EVENT");
      if (!TYPES.contains(type))
        return new Notification(
            id, JdbcMessageLog.fingerprint(new String(bytes, StandardCharsets.UTF_8)), type, null);
      if (!StripeHttpGateway.API_VERSION.equals(event.path("api_version").asText()))
        throw new BillingFailure("STRIPE_EVENT_VERSION_MISMATCH");
      String customer = event.path("data").path("object").path("customer").asText();
      if (!customer.matches("cus_[A-Za-z0-9]{1,120}"))
        throw new BillingFailure("INVALID_STRIPE_EVENT");
      return new Notification(
          id,
          JdbcMessageLog.fingerprint(new String(bytes, StandardCharsets.UTF_8)),
          type,
          customer);
    } catch (BillingFailure failure) {
      throw failure;
    } catch (Exception invalid) {
      throw new BillingFailure("INVALID_STRIPE_SIGNATURE");
    }
  }
}
