package vn.editor.payment.billing.infrastructure;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class BillingBodyLimitTest {
  @Test
  void preservesExactWebhookBytesAndRejectsChunkedOversizedRequests() throws Exception {
    byte[] bytes = "{\"text\":\"Tiếng Việt\"}\n".getBytes(StandardCharsets.UTF_8);
    var request = new MockHttpServletRequest("POST", "/api/v1/billing/webhooks/stripe");
    request.setContent(bytes);
    var response = new MockHttpServletResponse();
    var called = new AtomicBoolean();
    new BillingBodyLimit()
        .doFilter(
            request,
            response,
            (input, output) -> {
              assertArrayEquals(bytes, input.getInputStream().readAllBytes());
              called.set(true);
            });
    assertTrue(called.get());
    var oversized =
        new MockHttpServletRequest("POST", "/api/v1/billing/checkout") {
          @Override
          public long getContentLengthLong() {
            return -1;
          }
        };
    oversized.setContent(new byte[8193]);
    called.set(false);
    response = new MockHttpServletResponse();
    new BillingBodyLimit().doFilter(oversized, response, (input, output) -> called.set(true));
    assertFalse(called.get());
    assertEquals(413, response.getStatus());
    assertEquals("private, no-store", response.getHeader("Cache-Control"));
  }
}
