package vn.editor.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import org.junit.jupiter.api.Test;
import vn.editor.identity.auth.domain.Account;
import vn.editor.identity.auth.domain.AccountEmail;
import vn.editor.identity.auth.domain.AuthenticationFailure;
import vn.editor.identity.auth.domain.RefreshSession;
import vn.editor.identity.auth.domain.RegistrationPolicy;

class AuthenticationDomainTest {
  @Test
  void emailAndRegistrationPoliciesRetainCanonicalRules() {
    assertEquals("alice@example.com", new AccountEmail("Alice@EXAMPLE.com").value());
    assertThrows(AuthenticationFailure.class, () -> new AccountEmail("álîçé@example.com"));
    RegistrationPolicy.validatePassword("😀".repeat(12), true);
    assertThrows(
        AuthenticationFailure.class,
        () -> RegistrationPolicy.validatePassword("😀".repeat(129), true));
    RegistrationPolicy.validateDisplayName("😀".repeat(100));
    assertThrows(
        AuthenticationFailure.class,
        () -> RegistrationPolicy.validateDisplayName("😀".repeat(101)));
    assertEquals(
        AuthenticationFailure.Reason.EMAIL_ALREADY_REGISTERED,
        assertThrows(
                AuthenticationFailure.class, () -> RegistrationPolicy.requireCapacity(true, 10, 10))
            .reason());
  }

  @Test
  void refreshPolicyRejectsReuseExpiryAndInactiveAccountsWithoutChangingAbsoluteFamilyExpiry() {
    Instant now = Instant.parse("2026-10-04T00:00:00.123456789Z");
    Instant expiry = RefreshSession.newFamilyExpiry(now);
    assertEquals(Instant.parse("2026-10-18T00:00:00.123456Z"), expiry);
    Account active = new Account("a", new AccountEmail("a@example.com"), "hash", "A", true, now);
    RefreshSession fresh = new RefreshSession("r", "a", "f", "hash", expiry, false, false);
    assertTrue(fresh.mayRotate(active, now));
    assertFalse(
        new RefreshSession("r", "a", "f", "hash", expiry, true, false).mayRotate(active, now));
    assertFalse(
        new RefreshSession("r", "a", "f", "hash", expiry, false, true).mayRotate(active, now));
    assertFalse(fresh.mayRotate(active, expiry));
    assertFalse(fresh.mayRotate(new Account("a", active.email(), "hash", "A", false, now), now));
    assertFalse(RefreshSession.validRawToken("private invalid"));
    assertTrue(RefreshSession.validRawToken("a".repeat(43)));
  }
}
