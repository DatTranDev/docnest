package vn.editor.processing.jobs.infrastructure;

import java.io.IOException;
import java.io.InputStream;
import vn.editor.common.storage.StorageProvider;

/** Routes only configured input and output buckets; references never expand the allowlist. */
public final class ProcessingStorage implements StorageProvider {
  private final StorageProvider snapshots, results;

  public ProcessingStorage(StorageProvider snapshots, StorageProvider results) {
    this.snapshots = snapshots;
    this.results = results;
  }

  public String provider() {
    return results.provider();
  }

  public String bucket() {
    return results.bucket();
  }

  public Upload createUpload(String key, long bytes, String uploadId) throws IOException {
    throw new IOException("BROWSER_UPLOAD_NOT_SUPPORTED");
  }

  public Metadata inspect(String key) throws IOException {
    return results.inspect(key);
  }

  public InputStream read(ObjectRef ref) throws IOException {
    if (ref.key().startsWith("snapshots/")
        && java.util.Objects.equals(ref.bucket(), snapshots.bucket())) return snapshots.read(ref);
    if (ref.key().startsWith("results/")
        && java.util.Objects.equals(ref.bucket(), results.bucket())) return results.read(ref);
    throw new IOException("INVALID_OBJECT_REF");
  }

  public Metadata writeNew(String key, InputStream input, long expected, long cap)
      throws IOException {
    if (!key.startsWith("results/")) throw new IOException("INVALID_OUTPUT_KEY");
    return results.writeNew(key, input, expected, cap);
  }

  public void deleteGeneration(ObjectRef ref) throws IOException {
    if (!ref.key().startsWith("results/")
        || !java.util.Objects.equals(ref.bucket(), results.bucket()))
      throw new IOException("INVALID_OUTPUT_REF");
    results.deleteGeneration(ref);
  }
}
