package vn.editor.identity.auth.api;

import jakarta.servlet.http.HttpServletRequest;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import vn.editor.identity.auth.application.command.AuthenticationSession;
import vn.editor.identity.auth.application.command.CheckLoginAttemptCommand;
import vn.editor.identity.auth.application.command.CheckLoginAttemptHandler;
import vn.editor.identity.auth.application.command.LoginCommand;
import vn.editor.identity.auth.application.command.LoginHandler;
import vn.editor.identity.auth.application.command.LogoutCommand;
import vn.editor.identity.auth.application.command.LogoutHandler;
import vn.editor.identity.auth.application.command.RefreshSessionCommand;
import vn.editor.identity.auth.application.command.RefreshSessionHandler;
import vn.editor.identity.auth.application.command.RegisterAccountCommand;
import vn.editor.identity.auth.application.command.RegisterAccountHandler;
import vn.editor.identity.auth.application.query.GetProfileHandler;
import vn.editor.identity.auth.application.query.GetProfileQuery;
import vn.editor.identity.auth.application.query.GetSigningKeysHandler;
import vn.editor.identity.auth.application.query.IssueCsrfHandler;
import vn.editor.identity.auth.application.query.ResolveAccountHandler;
import vn.editor.identity.auth.application.query.ResolveAccountQuery;
import vn.editor.identity.auth.application.query.UserView;

@RestController
public final class IdentityController {
  private final RegisterAccountHandler register;
  private final LoginHandler login;
  private final RefreshSessionHandler refresh;
  private final LogoutHandler logout;
  private final GetProfileHandler profiles;
  private final ResolveAccountHandler accounts;
  private final GetSigningKeysHandler signingKeys;
  private final IssueCsrfHandler csrf;
  private final CheckLoginAttemptHandler rates;
  private final boolean secure;

  public IdentityController(
      RegisterAccountHandler register,
      LoginHandler login,
      RefreshSessionHandler refresh,
      LogoutHandler logout,
      GetProfileHandler profiles,
      ResolveAccountHandler accounts,
      GetSigningKeysHandler signingKeys,
      IssueCsrfHandler csrf,
      CheckLoginAttemptHandler rates,
      @Value("${editor.auth.secure-cookies}") boolean secure) {
    this.register = register;
    this.login = login;
    this.refresh = refresh;
    this.logout = logout;
    this.profiles = profiles;
    this.accounts = accounts;
    this.signingKeys = signingKeys;
    this.csrf = csrf;
    this.rates = rates;
    this.secure = secure;
  }

  public record Register(String email, String password, String displayName) {}

  public record Login(String email, String password) {}

  public record Resolve(String email) {}

  @GetMapping("/api/v1/auth/csrf")
  public ResponseEntity<?> csrf() {
    String value = csrf.handle();
    return ResponseEntity.ok()
        .header(HttpHeaders.SET_COOKIE, cookie("XSRF-TOKEN", value, Duration.ofHours(2)))
        .header(HttpHeaders.CACHE_CONTROL, "no-store")
        .body(Map.of("headerName", "X-CSRF-TOKEN", "token", value));
  }

  @PostMapping("/api/v1/auth/register")
  public ResponseEntity<?> register(@RequestBody Register request) {
    return ResponseEntity.status(201)
        .body(
            register.handle(
                new RegisterAccountCommand(
                    request.email(), request.password(), request.displayName())));
  }

  @PostMapping("/api/v1/auth/login")
  public ResponseEntity<?> login(@RequestBody Login request, HttpServletRequest http) {
    rates.handle(new CheckLoginAttemptCommand(http.getRemoteAddr()));
    return session(login.handle(new LoginCommand(request.email(), request.password())));
  }

  @PostMapping("/api/v1/auth/refresh")
  public ResponseEntity<?> refresh(
      @CookieValue(name = "refresh_token", required = false) String raw) {
    return session(refresh.handle(new RefreshSessionCommand(raw)));
  }

  @PostMapping("/api/v1/auth/logout")
  public ResponseEntity<?> logout(
      @CookieValue(name = "refresh_token", required = false) String raw) {
    logout.handle(new LogoutCommand(raw));
    return ResponseEntity.noContent()
        .header(HttpHeaders.SET_COOKIE, cookie("refresh_token", "", Duration.ZERO))
        .build();
  }

  @GetMapping("/api/v1/auth/me")
  public UserView me(@AuthenticationPrincipal Jwt jwt) {
    return profiles.handle(new GetProfileQuery(jwt.getSubject()));
  }

  @GetMapping("/.well-known/jwks.json")
  public ResponseEntity<?> jwks() {
    return ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "public,max-age=300")
        .body(signingKeys.handle());
  }

  @PostMapping("/internal/v1/users/resolve")
  public UserView resolve(
      @RequestHeader("X-Internal-Key") String key, @RequestBody Resolve request) {
    return accounts.handle(new ResolveAccountQuery(request.email(), key, true));
  }

  @GetMapping("/internal/v1/users/{id}")
  public UserView byId(@RequestHeader("X-Internal-Key") String key, @PathVariable String id) {
    return accounts.handle(new ResolveAccountQuery(id, key, false));
  }

  private ResponseEntity<?> session(AuthenticationSession session) {
    return ResponseEntity.ok()
        .header(
            HttpHeaders.SET_COOKIE,
            cookie(
                "refresh_token",
                session.refreshToken(),
                Duration.between(Instant.now(), session.expiresAt())))
        .header(HttpHeaders.CACHE_CONTROL, "no-store")
        .body(
            Map.of(
                "accessToken",
                session.accessToken(),
                "tokenType",
                "Bearer",
                "expiresIn",
                600,
                "user",
                session.user()));
  }

  private String cookie(String name, String value, Duration age) {
    return ResponseCookie.from(name, value)
        .httpOnly(true)
        .secure(secure)
        .sameSite("Lax")
        .path("/api/v1/auth")
        .maxAge(age)
        .build()
        .toString();
  }
}
