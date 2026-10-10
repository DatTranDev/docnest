package vn.editor.document.documents.application.command;

import java.io.IOException;
import java.io.InputStream;

public interface UploadCommandService {
  UploadView handle(CreateUploadCommand command) throws IOException;

  void upload(String actor, String uploadId, long contentLength, InputStream input)
      throws IOException;
}
