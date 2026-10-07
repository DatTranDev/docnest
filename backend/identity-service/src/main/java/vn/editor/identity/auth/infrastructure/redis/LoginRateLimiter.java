package vn.editor.identity.auth.infrastructure.redis;

import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;
import vn.editor.common.observability.OperationalMetrics;
import vn.editor.identity.auth.application.port.LoginAttempts;
import vn.editor.identity.auth.domain.AuthenticationFailure;
import vn.editor.identity.auth.infrastructure.security.SecureRefreshTokens;

/**
 * Fixed-window shared limiter. Only a hashed address reaches Redis; outages use a bounded local
 * window.
 */
@Component
public final class LoginRateLimiter implements LoginAttempts {
  static final int MAX_ATTEMPTS = 10;
  private static final int MAX_LOCAL_KEYS = 4096;
  private static final long WINDOW_MILLIS = 60_000;
  private static final DefaultRedisScript<Long> SCRIPT =
      new DefaultRedisScript<>(
          "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],60000) end; return n",
          Long.class);
  private final StringRedisTemplate redis;
  private final ConcurrentHashMap<String, Window> local = new ConcurrentHashMap<>();

  private static final class Window {
    final long expires;
    int attempts;

    Window(long expires) {
      this.expires = expires;
    }
  }

  public LoginRateLimiter(StringRedisTemplate redis) {
    this.redis = redis;
  }

  @Override
  public void attempt(String address) {
    String hash = SecureRefreshTokens.sha256(address == null ? "unknown" : address);
    boolean allowed;
    try {
      Long count = redis.execute(SCRIPT, List.of("rate:login:" + hash));
      if (count == null) throw new IllegalStateException("No rate result");
      allowed = count <= MAX_ATTEMPTS;
    } catch (RuntimeException unavailable) {
      OperationalMetrics.increment("identity-service", OperationalMetrics.Counter.REDIS_FALLBACK);
      allowed = localAttempt(hash);
    }
    if (!allowed)
      throw new AuthenticationFailure(
          AuthenticationFailure.Reason.RATE_LIMITED,
          "Too many login attempts; retry in one minute");
  }

  private synchronized boolean localAttempt(String hash) {
    long now = System.currentTimeMillis();
    local.entrySet().removeIf(e -> e.getValue().expires <= now);
    Window window = local.get(hash);
    if (window == null) {
      if (local.size() >= MAX_LOCAL_KEYS) return false;
      window = new Window(now + WINDOW_MILLIS);
      local.put(hash, window);
    }
    return ++window.attempts <= MAX_ATTEMPTS;
  }
}
