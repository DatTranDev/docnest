package vn.editor.document.documents.infrastructure;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.Semaphore;
import org.springframework.stereotype.Component;
import vn.editor.common.codec.NativeCodec;
import vn.editor.common.observability.OperationalMetrics;
import vn.editor.document.documents.application.port.SnapshotStore;
import vn.editor.document.documents.application.port.SnapshotValidator;
import vn.editor.document.documents.domain.UploadTicket;
import vn.editor.document.documents.domain.ValidatedSnapshot;
import vn.editor.document.shared.domain.DomainException;

@Component
public final class NativeSnapshotValidator implements SnapshotValidator {
  private final SnapshotStore storage;
  private final Semaphore validations = new Semaphore(2);

  public NativeSnapshotValidator(SnapshotStore storage) {
    this.storage = storage;
  }

  public int active() {
    return 2 - validations.availablePermits();
  }

  @Override
  public Result validate(UploadTicket ticket) throws IOException {
    if (!validations.tryAcquire()) throw new DomainException(429, "VALIDATION_BUSY");
    Path temporary = null;
    try {
      temporary = Files.createTempFile("tedoc-validation-", ".tedoc");
      SnapshotStore.Metadata metadata = storage.inspect(ticket.objectKey());
      if (metadata.bytes() != ticket.expectedBytes()
          || !metadata.sha256().equals(ticket.expectedHash()))
        throw new DomainException(422, "INVALID_NATIVE_FILE");
      if (metadata.bytes() > NativeCodec.MAX_NATIVE)
        throw new DomainException(413, "FILE_TOO_LARGE");
      try (InputStream input = storage.read(metadata.ref());
          OutputStream output = Files.newOutputStream(temporary)) {
        byte[] chunk = new byte[65536];
        long count = 0;
        for (int n; (n = input.read(chunk)) != -1; ) {
          count += n;
          if (count > NativeCodec.MAX_NATIVE) throw new DomainException(413, "FILE_TOO_LARGE");
          output.write(chunk, 0, n);
        }
      }
      NativeCodec.Decoded decoded = NativeCodec.decode(temporary);
      OperationalMetrics.snapshotBytes("document-service", decoded.nativeBytes());
      return new Result(
          new ValidatedSnapshot(decoded.nativeSha256(), decoded.nativeBytes(), decoded.manifest()),
          metadata);
    } catch (NativeCodec.InvalidNative ex) {
      throw new DomainException(ex.code.equals("FILE_TOO_LARGE") ? 413 : 422, ex.code);
    } finally {
      validations.release();
      if (temporary != null) Files.deleteIfExists(temporary);
    }
  }
}
