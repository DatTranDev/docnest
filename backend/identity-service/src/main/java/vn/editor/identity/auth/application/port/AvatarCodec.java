package vn.editor.identity.auth.application.port;

import vn.editor.identity.auth.application.query.AvatarImage;

public interface AvatarCodec {
  AvatarImage normalize(byte[] source, String mime);
}
