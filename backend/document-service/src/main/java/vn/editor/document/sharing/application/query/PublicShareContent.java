package vn.editor.document.sharing.application.query;

import java.io.InputStream;
import vn.editor.document.sharing.application.port.PublicTrafficLimit;

public record PublicShareContent(InputStream input, PublicTrafficLimit.Lease lease) {}
