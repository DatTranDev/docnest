package vn.editor.identity.auth.infrastructure.security;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.interfaces.RSAPrivateCrtKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import vn.editor.identity.auth.application.port.AccessTokens;

@Component
public class TokenKeys implements AccessTokens {
  private final RSAKey key;
  private final String issuer;

  public TokenKeys(
      @Value("${editor.jwt.key-path}") String keyPath,
      @Value("${editor.jwt.allow-key-generation}") boolean generate,
      @Value("${editor.jwt.issuer}") String issuer)
      throws Exception {
    this.issuer = issuer;
    Path path = Path.of(keyPath);
    if (!Files.exists(path)) {
      if (!generate)
        throw new IllegalStateException(
            "JWT key must be provided; local key generation is explicitly opt-in");
      KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
      gen.initialize(3072);
      KeyPair pair = gen.generateKeyPair();
      Path parent = path.toAbsolutePath().getParent();
      Files.createDirectories(parent);
      String pem =
          "-----BEGIN PRIVATE KEY-----\n"
              + Base64.getMimeEncoder(64, new byte[] {'\n'})
                  .encodeToString(pair.getPrivate().getEncoded())
              + "\n-----END PRIVATE KEY-----\n";
      Files.writeString(path, pem, StandardCharsets.US_ASCII, StandardOpenOption.CREATE_NEW);
    }
    String pem = Files.readString(path).replaceAll("-----[A-Z ]+-----", "").replaceAll("\\s", "");
    RSAPrivateCrtKey priv =
        (RSAPrivateCrtKey)
            KeyFactory.getInstance("RSA")
                .generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(pem)));
    RSAPublicKey pub =
        (RSAPublicKey)
            KeyFactory.getInstance("RSA")
                .generatePublic(
                    new java.security.spec.RSAPublicKeySpec(
                        priv.getModulus(), priv.getPublicExponent()));
    String kid =
        HexFormat.of()
            .formatHex(MessageDigest.getInstance("SHA-256").digest(pub.getEncoded()))
            .substring(0, 16);
    key = new RSAKey.Builder(pub).privateKey(priv).keyID(kid).algorithm(JWSAlgorithm.RS256).build();
  }

  public RSAPublicKey publicKey() {
    try {
      return key.toRSAPublicKey();
    } catch (JOSEException e) {
      throw new IllegalStateException(e);
    }
  }

  public Map<String, Object> jwks() {
    return Map.of("keys", List.of(key.toPublicJWK().toJSONObject()));
  }

  @Override
  public Map<String, Object> publicKeys() {
    return jwks();
  }

  public String issue(String userId) {
    return issue(userId, Instant.now(), "editor-api");
  }

  public String issue(String userId, Instant now, String audience) {
    try {
      SignedJWT jwt =
          new SignedJWT(
              new JWSHeader.Builder(JWSAlgorithm.RS256)
                  .keyID(key.getKeyID())
                  .type(JOSEObjectType.JWT)
                  .build(),
              new JWTClaimsSet.Builder()
                  .subject(userId)
                  .issuer(issuer)
                  .audience(audience)
                  .issueTime(Date.from(now))
                  .expirationTime(Date.from(now.plusSeconds(600)))
                  .jwtID(UUID.randomUUID().toString())
                  .build());
      jwt.sign(new RSASSASigner(key));
      return jwt.serialize();
    } catch (JOSEException e) {
      throw new IllegalStateException("JWT signing failed", e);
    }
  }
}
