package vn.editor.document.sharing.infrastructure;

import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import vn.editor.document.shared.domain.DomainException;
import vn.editor.document.shared.domain.Values;
import vn.editor.document.sharing.application.port.AccountDirectory;

@Component
public class IdentityClient implements AccountDirectory {
  @Override
  public Account resolve(String email, String authorization) {
    return account(resolvePayload(email, authorization));
  }

  @Override
  public Account user(String id, String authorization) {
    return account(userPayload(id, authorization));
  }

  private static Account account(Map<String, Object> body) {
    return new Account(
        (String) body.get("id"), (String) body.get("email"), (String) body.get("displayName"));
  }

  private final RestClient client;
  private final String key;

  public IdentityClient(
      @Value("${editor.identity-base-url:http://localhost:8081}") String base,
      @Value("${editor.document-internal-key:local-document-key-change-me}") String key) {
    var factory =
        new org.springframework.http.client.JdkClientHttpRequestFactory(
            java.net.http.HttpClient.newBuilder()
                .connectTimeout(java.time.Duration.ofSeconds(2))
                .build());
    factory.setReadTimeout(java.time.Duration.ofSeconds(2));
    client = RestClient.builder().requestFactory(factory).baseUrl(base).build();
    this.key = key;
  }

  private Map<String, Object> resolvePayload(String email, String authorization) {
    try {
      return client
          .post()
          .uri("/internal/v1/users/resolve")
          .header("Authorization", authorization)
          .header("X-Internal-Key", key)
          .body(Map.of("email", email))
          .retrieve()
          .body(Map.class);
    } catch (RestClientResponseException ex) {
      if (ex.getStatusCode().value() == 404 || ex.getStatusCode().value() == 422)
        throw new DomainException(422, "USER_NOT_REGISTERED");
      throw new DomainException(503, "IDENTITY_UNAVAILABLE");
    } catch (org.springframework.web.client.RestClientException ex) {
      throw new DomainException(503, "IDENTITY_UNAVAILABLE");
    }
  }

  private Map<String, Object> userPayload(String id, String authorization) {
    try {
      return client
          .get()
          .uri("/internal/v1/users/" + Values.id(id))
          .header("Authorization", authorization)
          .header("X-Internal-Key", key)
          .retrieve()
          .body(Map.class);
    } catch (RestClientResponseException ex) {
      if (ex.getStatusCode().value() == 404) throw new DomainException(422, "USER_NOT_REGISTERED");
      throw new DomainException(503, "IDENTITY_UNAVAILABLE");
    } catch (org.springframework.web.client.RestClientException ex) {
      throw new DomainException(503, "IDENTITY_UNAVAILABLE");
    }
  }
}
