package vn.editor.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import vn.editor.identity.auth.domain.AuthenticationFailure;
import vn.editor.identity.auth.infrastructure.security.ImageAvatarCodec;

class ImageAvatarCodecTest {
  @Test
  void acceptsActualImageAndRejectsMismatchedOrOversizedContent() throws Exception {
    var source = new ByteArrayOutputStream();
    ImageIO.write(new BufferedImage(2, 2, BufferedImage.TYPE_INT_RGB), "jpeg", source);
    var codec = new ImageAvatarCodec();
    var normalized = codec.normalize(source.toByteArray(), "image/jpeg");
    assertEquals("image/png", normalized.mime());
    assertEquals(0x89, normalized.bytes()[0] & 0xff);
    assertThrows(
        AuthenticationFailure.class, () -> codec.normalize(source.toByteArray(), "image/png"));
    assertThrows(
        AuthenticationFailure.class,
        () -> codec.normalize(new byte[ImageAvatarCodec.MAX_UPLOAD_BYTES + 1], "image/png"));
  }
}
