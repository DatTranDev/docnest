package vn.editor.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import vn.editor.identity.auth.application.port.AccountReadRepository;
import vn.editor.identity.auth.application.query.ResolveAccountHandler;
import vn.editor.identity.auth.application.query.ResolveAccountQuery;
import vn.editor.identity.auth.application.query.UserView;
import vn.editor.identity.auth.domain.AccountEmail;
import vn.editor.identity.auth.domain.AuthenticationFailure;

class SharingRecipientSecurityTest {
  @Test
  void passwordRegistrationAloneCannotResolveARecipientButMatchingProviderProofCan() {
    var accounts = mock(AccountReadRepository.class);
    var email = new AccountEmail("recipient@example.com");
    var user = new UserView("recipient", email.value(), "Recipient");
    when(accounts.activeByEmail(email)).thenReturn(user);
    var handler = new ResolveAccountHandler(accounts, key -> {});
    var query = new ResolveAccountQuery(email.value(), "internal-key", true);
    assertEquals(
        AuthenticationFailure.Reason.EMAIL_NOT_VERIFIED,
        assertThrows(AuthenticationFailure.class, () -> handler.handle(query)).reason());
    when(accounts.hasVerifiedEmail(user.id(), email)).thenReturn(true);
    assertEquals(user, handler.handle(query));
  }

  @Test
  void missingAccountRetainsItsExistingError() {
    var handler = new ResolveAccountHandler(mock(AccountReadRepository.class), key -> {});
    assertEquals(
        AuthenticationFailure.Reason.USER_NOT_REGISTERED,
        assertThrows(
                AuthenticationFailure.class,
                () -> handler.handle(new ResolveAccountQuery("nobody@example.com", "key", true)))
            .reason());
  }
}
