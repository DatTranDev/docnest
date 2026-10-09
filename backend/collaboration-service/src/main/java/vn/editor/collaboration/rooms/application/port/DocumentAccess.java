package vn.editor.collaboration.rooms.application.port;

import java.util.UUID;

public interface DocumentAccess {
  record Access(long headRevision, boolean writable) {}

  Access check(UUID documentId, String bearer);

  long save(UUID documentId, long headRevision, byte[] nativeFile, UUID key, String bearer);
}
