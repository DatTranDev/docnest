package vn.editor.identity.auth.infrastructure.security;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Locale;
import javax.imageio.ImageIO;
import org.springframework.stereotype.Component;
import vn.editor.identity.auth.application.port.AvatarCodec;
import vn.editor.identity.auth.application.query.AvatarImage;
import vn.editor.identity.auth.domain.AuthenticationFailure;

@Component
public final class ImageAvatarCodec implements AvatarCodec {
  public static final int MAX_UPLOAD_BYTES = 1024 * 1024;

  @Override
  public AvatarImage normalize(byte[] source, String mime) {
    if (source == null
        || source.length == 0
        || source.length > MAX_UPLOAD_BYTES
        || !("image/png".equals(mime) || "image/jpeg".equals(mime))) throw invalid();
    try (var stream = ImageIO.createImageInputStream(new ByteArrayInputStream(source))) {
      if (stream == null) throw invalid();
      var readers = ImageIO.getImageReaders(stream);
      if (!readers.hasNext()) throw invalid();
      var reader = readers.next();
      try {
        reader.setInput(stream, true, true);
        String format = reader.getFormatName().toLowerCase(Locale.ROOT);
        if (!("png".equals(format) && "image/png".equals(mime))
            && !("jpeg".equals(format) && "image/jpeg".equals(mime))) throw invalid();
        int width = reader.getWidth(0), height = reader.getHeight(0);
        if (width < 1 || height < 1 || width > 1024 || height > 1024) throw invalid();
        var decoded = reader.read(0);
        if (decoded == null) throw invalid();
        var output = new ByteArrayOutputStream();
        if (!ImageIO.write(decoded, "png", output) || output.size() > MAX_UPLOAD_BYTES)
          throw invalid();
        return new AvatarImage(output.toByteArray(), "image/png");
      } finally {
        reader.dispose();
      }
    } catch (IOException malformed) {
      throw invalid();
    }
  }

  private AuthenticationFailure invalid() {
    return new AuthenticationFailure(
        AuthenticationFailure.Reason.INVALID_AVATAR, "Invalid avatar image");
  }
}
