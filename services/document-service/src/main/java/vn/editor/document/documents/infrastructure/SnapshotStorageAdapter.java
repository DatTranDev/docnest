package vn.editor.document.documents.infrastructure;

import java.io.IOException;
import java.io.InputStream;
import java.time.Instant;
import org.springframework.stereotype.Component;
import vn.editor.common.storage.StorageProvider;
import vn.editor.document.documents.application.port.SnapshotStore;

@Component
public final class SnapshotStorageAdapter implements SnapshotStore {
  private final StorageProvider storage;

  public SnapshotStorageAdapter(StorageProvider storage) {
    this.storage = storage;
  }

  @Override
  public String provider() {
    return storage.provider();
  }

  @Override
  public String bucket() {
    return storage.bucket();
  }

  @Override
  public Upload createUpload(String key, long bytes, String upload) throws IOException {
    StorageProvider.Upload result = storage.createUpload(key, bytes, upload);
    return new Upload(result.kind(), result.url(), result.headers());
  }

  @Override
  public Metadata inspect(String key) throws IOException {
    return metadata(storage.inspect(key));
  }

  @Override
  public InputStream read(ObjectReference ref) throws IOException {
    return storage.read(reference(ref));
  }

  @Override
  public Metadata writeNew(String key, InputStream input, long bytes, long max) throws IOException {
    return metadata(storage.writeNew(key, input, bytes, max));
  }

  @Override
  public void cancelUpload(String uri) throws IOException {
    storage.cancelUpload(uri);
  }

  @Override
  public void deleteGeneration(ObjectReference ref) throws IOException {
    storage.deleteGeneration(reference(ref));
  }

  @Override
  public void cleanIncompleteBefore(Instant cutoff) throws IOException {
    storage.cleanIncompleteBefore(cutoff);
  }

  private static Metadata metadata(StorageProvider.Metadata value) {
    StorageProvider.ObjectRef ref = value.ref();
    return new Metadata(
        new ObjectReference(ref.provider(), ref.bucket(), ref.key(), ref.generation()),
        value.bytes(),
        value.sha256());
  }

  private static StorageProvider.ObjectRef reference(ObjectReference ref) {
    return new StorageProvider.ObjectRef(ref.provider(), ref.bucket(), ref.key(), ref.generation());
  }
}
