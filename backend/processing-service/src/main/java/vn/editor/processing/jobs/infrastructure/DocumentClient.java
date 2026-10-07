package vn.editor.processing.jobs.infrastructure;

import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import vn.editor.processing.jobs.application.JobFailure;

@Component
public class DocumentClient
    implements vn.editor.processing.jobs.application.port.DocumentAccessPort {
  private final RestClient http;
  private final String key;

  public DocumentClient(
      @Value("${editor.document-url}") String base,
      @Value("${editor.processing-internal-key}") String key) {
    this.key = key;
    var request = new org.springframework.http.client.SimpleClientHttpRequestFactory();
    request.setConnectTimeout(5000);
    request.setReadTimeout(10000);
    http = RestClient.builder().baseUrl(base).requestFactory(request).build();
  }

  @SuppressWarnings("unchecked")
  Map<String, Object> descriptor(String token, String id, long revision) {
    try {
      return http.get()
          .uri("/api/v1/documents/{id}/versions/{revision}/download", id, revision)
          .header("Authorization", token)
          .header("X-Internal-Key", key)
          .retrieve()
          .body(Map.class);
    } catch (RestClientResponseException e) {
      throw remote(e);
    } catch (org.springframework.web.client.RestClientException e) {
      throw new JobFailure(503, "DOCUMENT_UNAVAILABLE", "Document authorization is unavailable");
    }
  }

  public void authorize(String token, String id) {
    try {
      http.get()
          .uri("/api/v1/documents/{id}", id)
          .header("Authorization", token)
          .header("X-Internal-Key", key)
          .retrieve()
          .toBodilessEntity();
    } catch (RestClientResponseException e) {
      throw remote(e);
    } catch (org.springframework.web.client.RestClientException e) {
      throw new JobFailure(503, "DOCUMENT_UNAVAILABLE", "Document authorization is unavailable");
    }
  }

  public vn.editor.processing.jobs.application.port.SourceSnapshot snapshot(
      String token, String id, long revision) {
    var descriptor = descriptor(token, id, revision);
    var version = (Map<String, Object>) descriptor.get("version");
    try {
      return new vn.editor.processing.jobs.application.port.SourceSnapshot(
          new com.fasterxml.jackson.databind.ObjectMapper()
              .writeValueAsString(descriptor.get("objectRef")),
          (String) version.get("nativeSha256"));
    } catch (java.io.IOException e) {
      throw new JobFailure(503, "DOCUMENT_UNAVAILABLE", "Document descriptor is invalid");
    }
  }

  private JobFailure remote(RestClientResponseException e) {
    int status = e.getStatusCode().value();
    if (status == 401) return new JobFailure(401, "UNAUTHORIZED", "Sign in again");
    if (status == 403) return new JobFailure(403, "READ_ONLY", "Access denied");
    if (status == 404) return new JobFailure(404, "DOCUMENT_NOT_FOUND", "Document is unavailable");
    if (status == 410) return new JobFailure(410, "VERSION_GONE", "Version is no longer retained");
    return new JobFailure(503, "DOCUMENT_UNAVAILABLE", "Document authorization is unavailable");
  }
}
