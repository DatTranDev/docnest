package vn.editor.processing.jobs.infrastructure;

import java.io.IOException;
import java.io.InputStream;
import org.springframework.stereotype.Component;
import vn.editor.common.storage.StorageProvider;
import vn.editor.processing.jobs.application.port.ResultStoragePort;

@Component
public final class ResultStorageAdapter implements ResultStoragePort {
  private final StorageProvider storage;

  public ResultStorageAdapter(StorageProvider storage) {
    this.storage = storage;
  }

  public InputStream open(StorageProvider.ObjectRef reference) throws IOException {
    return storage.read(reference);
  }
}
