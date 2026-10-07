package vn.editor.common.storage;

import java.io.IOException;
import java.io.InputStream;
import java.util.Map;

public interface StorageProvider {
  record ObjectRef(String provider, String bucket, String key, String generation) {}

  record Metadata(ObjectRef ref, long bytes, String sha256) {}

  record Upload(String kind, String url, Map<String, String> headers) {}

  String provider();

  String bucket();

  Upload createUpload(String key, long bytes, String uploadId) throws IOException;

  Metadata inspect(String key) throws IOException;

  InputStream read(ObjectRef ref) throws IOException;

  Metadata writeNew(String key, InputStream input, long expected, long cap) throws IOException;

  void deleteGeneration(ObjectRef ref) throws IOException;

  default void cancelUpload(String session) throws IOException {}

  default void cleanIncompleteBefore(java.time.Instant cutoff) throws IOException {}
}
