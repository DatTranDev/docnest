package vn.editor.identity.auth.infrastructure.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashSet;
import java.util.Set;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import vn.editor.common.observability.TraceContext;
import vn.editor.identity.auth.application.port.CsrfTokens;

@Component
public class AuthCsrfFilter extends OncePerRequestFilter implements CsrfTokens {
  private final byte[] secret = new byte[32];
  private final Set<String> origins;

  public AuthCsrfFilter(@Value("${editor.auth.origins}") String origins) {
    new SecureRandom().nextBytes(secret);
    this.origins = new HashSet<>(Arrays.asList(origins.split(",")));
  }

  @Override
  public String issue() {
    byte[] bytes = new byte[32];
    new SecureRandom().nextBytes(bytes);
    String value = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    return value + "." + sign(value);
  }

  private String sign(String value) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(secret, "HmacSHA256"));
      return Base64.getUrlEncoder()
          .withoutPadding()
          .encodeToString(mac.doFinal(value.getBytes(StandardCharsets.US_ASCII)));
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException(e);
    }
  }

  public boolean valid(String token) {
    if (token == null || token.length() != 87) return false;
    int p = token.indexOf('.');
    return p == 43
        && MessageDigest.isEqual(
            sign(token.substring(0, p)).getBytes(StandardCharsets.US_ASCII),
            token.substring(p + 1).getBytes(StandardCharsets.US_ASCII));
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest req, HttpServletResponse res, FilterChain chain)
      throws ServletException, IOException {
    if (req.getMethod().equals("POST") && req.getRequestURI().startsWith("/api/v1/auth/")) {
      String header = req.getHeader("X-CSRF-TOKEN"), cookie = null;
      if (req.getCookies() != null)
        for (Cookie c : req.getCookies())
          if (c.getName().equals("XSRF-TOKEN")) cookie = c.getValue();
      if (!origins.contains(req.getHeader("Origin"))
          || !valid(header)
          || cookie == null
          || !MessageDigest.isEqual(
              header.getBytes(StandardCharsets.US_ASCII),
              cookie.getBytes(StandardCharsets.US_ASCII))) {
        res.setStatus(403);
        res.setContentType("application/json");
        res.getWriter()
            .write(
                "{\"code\":\"CSRF_INVALID\",\"message\":\"CSRF or origin validation failed\",\"traceId\":\""
                    + TraceContext.traceId()
                    + "\"}");
        return;
      }
    }
    chain.doFilter(req, res);
  }
}
