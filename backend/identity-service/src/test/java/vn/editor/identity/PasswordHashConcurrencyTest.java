package vn.editor.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import vn.editor.identity.auth.domain.AuthenticationFailure;
import vn.editor.identity.auth.infrastructure.security.Argon2PasswordHashes;

class PasswordHashConcurrencyTest {
  @Test
  void encodeAndVerificationShareABoundedBudgetWithoutQueuing() throws Exception {
    var encoder = mock(Argon2PasswordEncoder.class);
    var entered = new CountDownLatch(2);
    var release = new CountDownLatch(1);
    when(encoder.encode(anyString()))
        .thenAnswer(
            invocation -> {
              entered.countDown();
              if (!release.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("Timeout");
              return "hash";
            });
    when(encoder.matches("password", "hash")).thenReturn(true);
    var hashes = new Argon2PasswordHashes(encoder);
    try (var executor = Executors.newFixedThreadPool(2)) {
      var first = executor.submit(() -> hashes.encode("first"));
      var second = executor.submit(() -> hashes.encode("second"));
      try {
        assertTrue(entered.await(5, TimeUnit.SECONDS));
        assertEquals(
            AuthenticationFailure.Reason.RATE_LIMITED,
            assertThrows(AuthenticationFailure.class, () -> hashes.encode("third")).reason());
        assertEquals(
            AuthenticationFailure.Reason.RATE_LIMITED,
            assertThrows(AuthenticationFailure.class, () -> hashes.matches("password", "hash"))
                .reason());
      } finally {
        release.countDown();
      }
      assertEquals("hash", first.get(5, TimeUnit.SECONDS));
      assertEquals("hash", second.get(5, TimeUnit.SECONDS));
      assertTrue(hashes.matches("password", "hash"));
    }
  }

  @Test
  void encoderFailuresReleaseTheirBudget() {
    var encoder = mock(Argon2PasswordEncoder.class);
    when(encoder.encode(anyString())).thenThrow(new IllegalStateException("Failure"));
    when(encoder.matches("password", "hash")).thenReturn(true);
    var hashes = new Argon2PasswordHashes(encoder);
    for (int attempt = 0; attempt < 3; attempt++)
      assertThrows(IllegalStateException.class, () -> hashes.encode("password"));
    assertTrue(hashes.matches("password", "hash"));
  }
}
