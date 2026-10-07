package vn.editor.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;
import org.junit.jupiter.api.Test;
import vn.editor.identity.auth.api.ApiErrors;
import vn.editor.identity.auth.domain.AuthenticationFailure;

class AuthenticationHttpMappingTest {
  @Test
  void domainFailuresRetainContractStatusCodesAndRateRetryHeader() {
    ApiErrors mapper = new ApiErrors();
    var limited =
        mapper.handle(
            new AuthenticationFailure(AuthenticationFailure.Reason.RATE_LIMITED, "Retry later"));
    assertEquals(429, limited.getStatusCode().value());
    assertEquals("60", limited.getHeaders().getFirst("Retry-After"));
    assertEquals("RATE_LIMITED", ((Map<?, ?>) limited.getBody()).get("code"));
    var quota =
        mapper.handle(
            new AuthenticationFailure(
                AuthenticationFailure.Reason.ACCOUNT_QUOTA, "Account quota reached"));
    assertEquals("QUOTA_EXCEEDED", ((Map<?, ?>) quota.getBody()).get("code"));
    assertFalse(quota.getHeaders().containsHeader("Retry-After"));
    var unavailable =
        mapper.handle(
            new AuthenticationFailure(
                AuthenticationFailure.Reason.ACCOUNT_UNAVAILABLE, "Account is unavailable"));
    assertEquals(404, unavailable.getStatusCode().value());
    assertEquals("USER_NOT_REGISTERED", ((Map<?, ?>) unavailable.getBody()).get("code"));
  }

  @Test
  void invalidRequestsDoNotEchoExceptionOrPrivateInput() {
    var response = new ApiErrors().badRequest(new IllegalArgumentException("password=private"));
    assertEquals(400, response.getStatusCode().value());
    Map<?, ?> body = (Map<?, ?>) response.getBody();
    assertEquals("INVALID_REQUEST", body.get("code"));
    assertTrue(body.containsKey("traceId"));
    assertFalse(body.toString().contains("private"));
  }
}
