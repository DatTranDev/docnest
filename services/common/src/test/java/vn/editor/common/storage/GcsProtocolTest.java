package vn.editor.common.storage;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.auth.oauth2.AccessToken;
import com.google.auth.oauth2.GoogleCredentials;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.util.Date;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import vn.editor.common.codec.NativeCodec;

class GcsProtocolTest {
  @Test
  void realHttpSessionUsesCreateOnlyLengthOriginAndCancelableCapability() throws Exception {
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    String base = "http://127.0.0.1:" + server.getAddress().getPort();
    AtomicReference<String> query = new AtomicReference<>(),
        length = new AtomicReference<>(),
        origin = new AtomicReference<>(),
        cancel = new AtomicReference<>();
    server.createContext(
        "/upload/storage/v1/b/test-bucket/o",
        exchange -> {
          query.set(exchange.getRequestURI().getRawQuery());
          length.set(exchange.getRequestHeaders().getFirst("X-Upload-Content-Length"));
          origin.set(exchange.getRequestHeaders().getFirst("Origin"));
          exchange.getRequestBody().readAllBytes();
          exchange.getResponseHeaders().set("Location", base + "/session/capability");
          exchange.sendResponseHeaders(200, -1);
          exchange.close();
        });
    server.createContext(
        "/session/capability",
        exchange -> {
          cancel.set(exchange.getRequestMethod());
          exchange.sendResponseHeaders(499, -1);
          exchange.close();
        });
    server.start();
    try {
      GoogleCredentials credentials =
          GoogleCredentials.create(
              new AccessToken("test-only-token", new Date(System.currentTimeMillis() + 3600000)));
      GcsStorage adapter =
          new GcsStorage(null, credentials, "test-bucket", "https://editor.example", base);
      var upload = adapter.createUpload("snapshots/uuid/upload.tedoc", 1024, "uuid");
      assertEquals("GCS_RESUMABLE", upload.kind());
      assertTrue(query.get().contains("ifGenerationMatch=0"));
      assertTrue(query.get().contains("uploadType=resumable"));
      assertTrue(query.get().contains("name=snapshots%2Fuuid%2Fupload.tedoc"));
      assertEquals("1024", length.get());
      assertEquals("https://editor.example", origin.get());
      adapter.cancelUpload(upload.url());
      assertEquals("DELETE", cancel.get());
      assertThrows(
          java.io.IOException.class, () -> adapter.createUpload("snapshots/../secret", 1024, "id"));
      assertThrows(
          java.io.IOException.class, () -> adapter.cancelUpload("http://evil.invalid/session"));
    } finally {
      server.stop(0);
    }
  }

  @Test
  void sdkReadAndDeletePinTheExactGenerationAndInspectHashesRealBytes() throws Exception {
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    String base = "http://127.0.0.1:" + server.getAddress().getPort();
    List<String> reads = new java.util.concurrent.CopyOnWriteArrayList<>(),
        deletes = new java.util.concurrent.CopyOnWriteArrayList<>();
    byte[] payload = {1, 2, 3};
    server.createContext(
        "/",
        exchange -> {
          String query = Objects.toString(exchange.getRequestURI().getRawQuery(), "");
          byte[] body;
          if (exchange.getRequestMethod().equals("DELETE")) {
            deletes.add(query);
            exchange.sendResponseHeaders(204, -1);
            exchange.close();
            return;
          }
          if (query.contains("alt=media")) {
            reads.add(query);
            body = payload;
            exchange.getResponseHeaders().set("Content-Type", "application/octet-stream");
          } else {
            body =
                "{\"kind\":\"storage#object\",\"bucket\":\"test-bucket\",\"name\":\"snapshots/uuid/native.tedoc\",\"generation\":\"123\",\"metageneration\":\"1\",\"size\":\"3\",\"contentType\":\"application/octet-stream\"}"
                    .getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
          }
          exchange.sendResponseHeaders(200, body.length);
          exchange.getResponseBody().write(body);
          exchange.close();
        });
    server.start();
    try {
      var sdk =
          com.google.cloud.storage.StorageOptions.newBuilder()
              .setProjectId("local-contract-test")
              .setHost(base)
              .setCredentials(com.google.cloud.NoCredentials.getInstance())
              .build()
              .getService();
      GcsStorage adapter =
          new GcsStorage(
              sdk,
              GoogleCredentials.create(
                  new AccessToken(
                      "test-only-token", new Date(System.currentTimeMillis() + 3600000))),
              "test-bucket",
              "https://editor.example",
              base);
      var inspected = adapter.inspect("snapshots/uuid/native.tedoc");
      assertEquals("123", inspected.ref().generation());
      assertEquals(3, inspected.bytes());
      assertEquals(NativeCodec.sha256(payload), inspected.sha256());
      try (var input = adapter.read(inspected.ref())) {
        assertArrayEquals(payload, input.readAllBytes());
      }
      adapter.deleteGeneration(inspected.ref());
      assertFalse(reads.isEmpty());
      for (String query : reads) {
        assertTrue(query.contains("generation=123"), query);
        assertTrue(query.contains("ifGenerationMatch=123"), query);
      }
      assertEquals(1, deletes.size());
      assertTrue(deletes.getFirst().contains("generation=123"));
      assertTrue(deletes.getFirst().contains("ifGenerationMatch=123"));
      assertThrows(
          java.io.IOException.class,
          () ->
              adapter.read(
                  new StorageProvider.ObjectRef(
                      "GCS", "another-bucket", "snapshots/uuid/native.tedoc", "123")));
    } finally {
      server.stop(0);
    }
  }
}
