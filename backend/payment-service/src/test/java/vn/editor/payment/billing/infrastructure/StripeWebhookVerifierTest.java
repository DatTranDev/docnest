package vn.editor.payment.billing.infrastructure;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import vn.editor.payment.billing.domain.BillingFailure;

class StripeWebhookVerifierTest {
  private static final String SECRET = "whsec_contract_fixture_only";
  private static final long NOW = 1791500000;
  private final StripeWebhookVerifier verifier =
      new StripeWebhookVerifier(SECRET, Clock.fixed(Instant.ofEpochSecond(NOW), ZoneOffset.UTC));
  private final byte[] body =
      ("{\"id\":\"evt_contract1\",\"type\":\"invoice.paid\",\"api_version\":\""
              + StripeHttpGateway.API_VERSION
              + "\",\"livemode\":false,\"data\":{\"object\":{\"customer\":\"cus_contract1\"}}}")
          .getBytes(StandardCharsets.UTF_8);

  private String signature(byte[] bytes, long time) throws Exception {
    var mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    mac.update((time + ".").getBytes(StandardCharsets.US_ASCII));
    return "t=" + time + ",v1=" + HexFormat.of().formatHex(mac.doFinal(bytes));
  }

  @Test
  void validatesExactRawBytesAndRotatedV1Signatures() throws Exception {
    var valid = verifier.verify(body, signature(body, NOW) + ",v1=" + "0".repeat(64));
    assertEquals("cus_contract1", valid.customer());
    assertEquals("evt_contract1", valid.eventId());
    assertThrows(
        BillingFailure.class,
        () ->
            verifier.verify(
                (new String(body, StandardCharsets.UTF_8) + " ").getBytes(StandardCharsets.UTF_8),
                signature(body, NOW)));
    assertThrows(BillingFailure.class, () -> verifier.verify(body, null));
  }

  @Test
  void rejectsReplayFutureAmbiguousTimestampLiveAndWrongVersions() throws Exception {
    for (long time : new long[] {NOW - 301, NOW + 301})
      assertThrows(BillingFailure.class, () -> verifier.verify(body, signature(body, time)));
    assertThrows(
        BillingFailure.class, () -> verifier.verify(body, signature(body, NOW) + ",t=" + NOW));
    var live =
        new String(body, StandardCharsets.UTF_8)
            .replace("false", "true")
            .getBytes(StandardCharsets.UTF_8);
    assertThrows(BillingFailure.class, () -> verifier.verify(live, signature(live, NOW)));
    var old =
        new String(body, StandardCharsets.UTF_8)
            .replace(StripeHttpGateway.API_VERSION, "2020-01-01")
            .getBytes(StandardCharsets.UTF_8);
    assertEquals(
        "STRIPE_EVENT_VERSION_MISMATCH",
        assertThrows(BillingFailure.class, () -> verifier.verify(old, signature(old, NOW)))
            .getMessage());
  }

  @Test
  void unavailableConfigurationAndMalformedEventsHaveRedactedErrors() throws Exception {
    assertEquals(
        "STRIPE_NOT_CONFIGURED",
        assertThrows(
                BillingFailure.class,
                () -> new StripeWebhookVerifier("", Clock.systemUTC()).verify(body, "bad"))
            .getMessage());
    byte[] invalid = "{\"privatePayload\":\"do-not-log-this\"}".getBytes(StandardCharsets.UTF_8);
    assertEquals(
        "INVALID_STRIPE_EVENT",
        assertThrows(BillingFailure.class, () -> verifier.verify(invalid, signature(invalid, NOW)))
            .getMessage());
  }
}
