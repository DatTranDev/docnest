package vn.editor.document.documents.application.port;

import vn.editor.document.documents.application.query.DocumentView;

public interface MetadataProjection {
  DocumentView afterAuthorization(DocumentView live);
}
