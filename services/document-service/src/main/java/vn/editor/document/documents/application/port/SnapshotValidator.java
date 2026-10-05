package vn.editor.document.documents.application.port;

import java.io.IOException;
import vn.editor.document.documents.domain.UploadTicket;
import vn.editor.document.documents.domain.ValidatedSnapshot;

public interface SnapshotValidator {
  record Result(ValidatedSnapshot snapshot, SnapshotStore.Metadata metadata) {}

  Result validate(UploadTicket ticket) throws IOException;
}
