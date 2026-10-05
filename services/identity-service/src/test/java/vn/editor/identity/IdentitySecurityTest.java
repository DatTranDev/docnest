package vn.editor.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.nio.file.Path;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import vn.editor.identity.auth.infrastructure.security.AuthCsrfFilter;
import vn.editor.identity.auth.infrastructure.security.TokenKeys;
import vn.editor.identity.bootstrap.IdentitySecurity;

class IdentitySecurityTest {
  @TempDir Path dir;

  @Test
  void rs256IssuerAudienceAndExpiryAreEnforced() throws Exception {
    TokenKeys keys =
        new TokenKeys(dir.resolve("key.pem").toString(), true, "https://editor.example");
    JwtDecoder decoder = new IdentitySecurity().jwtDecoder(keys, "https://editor.example");
    String user = UUID.randomUUID().toString();
    assertEquals(user, decoder.decode(keys.issue(user)).getSubject());
    assertThrows(
        JwtException.class, () -> decoder.decode(keys.issue(user, Instant.now(), "wrong")));
    assertThrows(
        JwtException.class,
        () -> decoder.decode(keys.issue(user, Instant.now().minusSeconds(700), "editor-api")));
    TokenKeys wrongIssuer =
        new TokenKeys(dir.resolve("key.pem").toString(), false, "https://wrong.example");
    assertThrows(JwtException.class, () -> decoder.decode(wrongIssuer.issue(user)));
    SignedJWT hs =
        new SignedJWT(
            new JWSHeader(JWSAlgorithm.HS256), new JWTClaimsSet.Builder().subject(user).build());
    hs.sign(new MACSigner(new byte[32]));
    assertThrows(JwtException.class, () -> decoder.decode(hs.serialize()));
    assertFalse(keys.jwks().toString().contains("private"));
    assertFalse(keys.jwks().toString().contains("\"d\""));
  }

  @Test
  void signedDoubleSubmitCsrfRejectsForgeryAndForeignOrigin() throws Exception {
    AuthCsrfFilter filter = new AuthCsrfFilter("http://localhost:8080");
    String token = filter.issue();
    assertTrue(filter.valid(token));
    assertFalse(filter.valid(token.substring(0, 86) + "x"));
    MockHttpServletRequest req = new MockHttpServletRequest("POST", "/api/v1/auth/login");
    req.addHeader("Origin", "https://attacker.example");
    req.addHeader("X-CSRF-TOKEN", token);
    req.setCookies(new jakarta.servlet.http.Cookie("XSRF-TOKEN", token));
    MockHttpServletResponse res = new MockHttpServletResponse();
    filter.doFilter(req, res, new MockFilterChain());
    assertEquals(403, res.getStatus());
    req = new MockHttpServletRequest("POST", "/api/v1/auth/login");
    req.addHeader("Origin", "http://localhost:8080");
    req.addHeader("X-CSRF-TOKEN", token);
    req.setCookies(new jakarta.servlet.http.Cookie("XSRF-TOKEN", token));
    res = new MockHttpServletResponse();
    filter.doFilter(req, res, new MockFilterChain());
    assertEquals(200, res.getStatus());
  }

  @Test
  void argon2idUsesSpecifiedMinimums() {
    var passwords = new IdentitySecurity().passwords();
    String hash = passwords.encode("a valid long password");
    assertTrue(hash.startsWith("$argon2id$"));
    assertTrue(hash.contains("m=19456,t=2,p=1"));
    assertTrue(passwords.matches("a valid long password", hash));
    assertFalse(passwords.matches("another password", hash));
  }
}
