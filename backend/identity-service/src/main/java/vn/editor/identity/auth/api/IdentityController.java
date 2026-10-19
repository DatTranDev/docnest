package vn.editor.identity.auth.api;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import vn.editor.identity.auth.api.dto.GoogleLoginRequestDto;
import vn.editor.identity.auth.api.dto.LinkGoogleRequestDto;
import vn.editor.identity.auth.api.dto.LoginRequestDto;
import vn.editor.identity.auth.api.dto.RegisterRequestDto;
import vn.editor.identity.auth.api.dto.ResolveAccountRequestDto;
import vn.editor.identity.auth.api.dto.SetupPasswordRequestDto;
import vn.editor.identity.auth.api.dto.UnlinkGoogleRequestDto;
import vn.editor.identity.auth.api.dto.UserResponseDto;
import vn.editor.identity.auth.application.command.AuthenticationSession;
import vn.editor.identity.auth.application.command.ChangeAvatarService;
import vn.editor.identity.auth.application.command.CheckLoginAttemptCommand;
import vn.editor.identity.auth.application.command.CheckLoginAttemptService;
import vn.editor.identity.auth.application.command.GoogleLoginService;
import vn.editor.identity.auth.application.command.LinkGoogleService;
import vn.editor.identity.auth.application.command.LoginCommand;
import vn.editor.identity.auth.application.command.LoginService;
import vn.editor.identity.auth.application.command.LogoutCommand;
import vn.editor.identity.auth.application.command.LogoutService;
import vn.editor.identity.auth.application.command.ManageCredentialsService;
import vn.editor.identity.auth.application.command.RefreshSessionCommand;
import vn.editor.identity.auth.application.command.RefreshSessionService;
import vn.editor.identity.auth.application.command.RegisterAccountCommand;
import vn.editor.identity.auth.application.command.RegisterAccountService;
import vn.editor.identity.auth.application.query.GetAvatarService;
import vn.editor.identity.auth.application.query.GetCredentialStatusService;
import vn.editor.identity.auth.application.query.GetProfileQuery;
import vn.editor.identity.auth.application.query.GetProfileService;
import vn.editor.identity.auth.application.query.GetSigningKeysService;
import vn.editor.identity.auth.application.query.IssueCsrfService;
import vn.editor.identity.auth.application.query.PublicProfileView;
import vn.editor.identity.auth.application.query.ResolveAccountQuery;
import vn.editor.identity.auth.application.query.ResolveAccountService;
import vn.editor.identity.auth.application.query.UserView;

@RestController
public final class IdentityController {
  private final RegisterAccountService register;
  private final LoginService login;
  private final GoogleLoginService googleLogin;
  private final LinkGoogleService linkGoogle;
  private final ManageCredentialsService credentials;
  private final ChangeAvatarService avatarChanges;
  private final GetAvatarService avatars;
  private final GetCredentialStatusService methods;
  private final RefreshSessionService refresh;
  private final LogoutService logout;
  private final GetProfileService profiles;
  private final ResolveAccountService accounts;
  private final GetSigningKeysService signingKeys;
  private final IssueCsrfService csrf;
  private final CheckLoginAttemptService rates;
  private final boolean secure;

  public IdentityController(
      RegisterAccountService register,
      LoginService login,
      GoogleLoginService googleLogin,
      LinkGoogleService linkGoogle,
      ManageCredentialsService credentials,
      ChangeAvatarService avatarChanges,
      GetAvatarService avatars,
      GetCredentialStatusService methods,
      RefreshSessionService refresh,
      LogoutService logout,
      GetProfileService profiles,
      ResolveAccountService accounts,
      GetSigningKeysService signingKeys,
      IssueCsrfService csrf,
      CheckLoginAttemptService rates,
      @Value("${editor.auth.secure-cookies}") boolean secure) {
    this.register = register;
    this.login = login;
    this.googleLogin = googleLogin;
    this.linkGoogle = linkGoogle;
    this.credentials = credentials;
    this.avatarChanges = avatarChanges;
    this.avatars = avatars;
    this.methods = methods;
    this.refresh = refresh;
    this.logout = logout;
    this.profiles = profiles;
    this.accounts = accounts;
    this.signingKeys = signingKeys;
    this.csrf = csrf;
    this.rates = rates;
    this.secure = secure;
  }

  @GetMapping("/api/v1/auth/csrf")
  public ResponseEntity<?> csrf() {
    String value = csrf.handle();
    return ResponseEntity.ok()
        .header(HttpHeaders.SET_COOKIE, cookie("XSRF-TOKEN", value, Duration.ofHours(2)))
        .header(HttpHeaders.CACHE_CONTROL, "no-store")
        .body(Map.of("headerName", "X-CSRF-TOKEN", "token", value));
  }

  @PostMapping("/api/v1/auth/register")
  public ResponseEntity<?> register(@RequestBody RegisterRequestDto request) {
    return ResponseEntity.status(201)
        .body(
            UserResponseDto.from(
                register.handle(
                    new RegisterAccountCommand(
                        request.email(), request.password(), request.displayName()))));
  }

  @PostMapping("/api/v1/auth/login")
  public ResponseEntity<?> login(@RequestBody LoginRequestDto request, HttpServletRequest http) {
    rates.handle(new CheckLoginAttemptCommand(http.getRemoteAddr()));
    return session(login.handle(new LoginCommand(request.email(), request.password())));
  }

  @PostMapping("/api/v1/auth/google")
  public ResponseEntity<?> googleLogin(
      @RequestBody GoogleLoginRequestDto request, HttpServletRequest http) {
    rates.handle(new CheckLoginAttemptCommand(http.getRemoteAddr()));
    return session(googleLogin.handle(request.credential()));
  }

  @PostMapping("/api/v1/auth/google/link")
  public ResponseEntity<?> linkGoogle(
      @RequestBody LinkGoogleRequestDto request, HttpServletRequest http) {
    rates.handle(new CheckLoginAttemptCommand(http.getRemoteAddr()));
    return session(linkGoogle.handle(request.email(), request.password(), request.credential()));
  }

  @PostMapping("/api/v1/auth/password/setup")
  public ResponseEntity<?> setupPassword(
      @AuthenticationPrincipal Jwt jwt, @RequestBody SetupPasswordRequestDto request) {
    credentials.setupPassword(jwt.getSubject(), request.newPassword(), request.googleCredential());
    return ResponseEntity.noContent().build();
  }

  @PostMapping("/api/v1/auth/google/unlink")
  public ResponseEntity<?> unlinkGoogle(
      @AuthenticationPrincipal Jwt jwt, @RequestBody UnlinkGoogleRequestDto request) {
    credentials.unlinkGoogle(jwt.getSubject(), request.currentPassword());
    return ResponseEntity.noContent().build();
  }

  @PutMapping("/api/v1/auth/me/avatar")
  public ResponseEntity<?> uploadAvatar(
      @AuthenticationPrincipal Jwt jwt, HttpServletRequest request) throws IOException {
    if (request.getContentLengthLong() > 1024 * 1024) throw new IllegalArgumentException();
    byte[] image = request.getInputStream().readNBytes(1024 * 1024 + 1);
    avatarChanges.upload(jwt.getSubject(), image, request.getContentType());
    return ResponseEntity.noContent().build();
  }

  @DeleteMapping("/api/v1/auth/me/avatar")
  public ResponseEntity<?> removeAvatar(@AuthenticationPrincipal Jwt jwt) {
    avatarChanges.remove(jwt.getSubject());
    return ResponseEntity.noContent().build();
  }

  @GetMapping("/api/v1/avatars/{id}")
  public ResponseEntity<?> avatar(@PathVariable String id) {
    var image = avatars.handle(id);
    if (image == null) return ResponseEntity.notFound().build();
    return ResponseEntity.ok()
        .contentType(MediaType.IMAGE_PNG)
        .header(HttpHeaders.CACHE_CONTROL, "public,max-age=300")
        .body(image.bytes());
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
  public UserResponseDto me(@AuthenticationPrincipal Jwt jwt) {
    return UserResponseDto.from(profiles.handle(new GetProfileQuery(jwt.getSubject())));
  }

  @GetMapping("/api/v1/auth/methods")
  public vn.editor.identity.auth.application.query.CredentialStatus methods(
      @AuthenticationPrincipal Jwt jwt) {
    return methods.handle(jwt.getSubject());
  }

  @GetMapping("/api/v1/users/{id}/profile")
  public PublicProfileView publicProfile(@PathVariable String id) {
    return PublicProfileView.from(profiles.handle(new GetProfileQuery(id)));
  }

  @GetMapping("/.well-known/jwks.json")
  public ResponseEntity<?> jwks() {
    return ResponseEntity.ok()
        .header(HttpHeaders.CACHE_CONTROL, "public,max-age=300")
        .body(signingKeys.handle());
  }

  @PostMapping("/internal/v1/users/resolve")
  public UserView resolve(
      @RequestHeader("X-Internal-Key") String key, @RequestBody ResolveAccountRequestDto request) {
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
                UserResponseDto.from(session.user())));
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
