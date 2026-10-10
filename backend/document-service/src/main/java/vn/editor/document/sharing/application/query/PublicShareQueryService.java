package vn.editor.document.sharing.application.query;

import java.io.IOException;

public interface PublicShareQueryService {
  PublicDocumentView document(String token, String address);

  PublicShareContent content(String token, String address) throws IOException;
}
