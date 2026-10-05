package vn.editor.processing.jobs.application.port;

import java.io.IOException;
import java.io.InputStream;
import vn.editor.common.storage.StorageProvider.ObjectRef;

public interface ResultStoragePort {
  InputStream open(ObjectRef reference) throws IOException;
}
