package vn.editor.document.documents.application.port;

import java.io.IOException;
import java.io.InputStream;
import java.time.Instant;
import java.util.Map;

public interface SnapshotStore {
  record ObjectReference(String provider, String bucket, String key, String generation) {}

  record Metadata(ObjectReference ref, long bytes, String sha256) {}

  record Upload(String kind, String url, Map<String, String> headers) {}

  String provider();

  String bucket();

  Upload createUpload(String key, long bytes, String upload) throws IOException;

  Metadata inspect(String key) throws IOException;

  InputStream read(ObjectReference reference) throws IOException;

  Metadata writeNew(String key, InputStream input, long bytes, long maximum) throws IOException;

  void cancelUpload(String uri) throws IOException;

  void deleteGeneration(ObjectReference reference) throws IOException;

  void cleanIncompleteBefore(Instant cutoff) throws IOException;
}
