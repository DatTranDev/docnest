package vn.editor.document.sharing.infrastructure;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;
import vn.editor.common.codec.NativeCodec;
import vn.editor.common.observability.OperationalMetrics;
import vn.editor.document.shared.domain.DomainException;
import vn.editor.document.sharing.application.port.PublicTrafficLimit;

@Component
public class PublicRateLimit implements PublicTrafficLimit {
  @Override
  public Lease acquireStream(String ip) {
    Semaphore semaphore = stream(ip);
    return semaphore::release;
  }

  private final StringRedisTemplate redis;
  private final ConcurrentHashMap<String, Counter> fallback = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, Semaphore> streams = new ConcurrentHashMap<>();

  private record Counter(long minute, int count) {}

  public PublicRateLimit(StringRedisTemplate redis) {
    this.redis = redis;
  }

  public void take(String ip, boolean download) {
    String hash = NativeCodec.sha256(ip.getBytes(StandardCharsets.UTF_8)),
        key = "rate:public:" + hash + ":" + (download ? "download" : "metadata");
    int limit = download ? 10 : 20;
    try {
      Long n =
          redis.execute(
              new DefaultRedisScript<>(
                  "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60)"
                      + " end; return n",
                  Long.class),
              List.of(key));
      if (n != null && n > limit) throw new DomainException(429, "RATE_LIMITED");
    } catch (DomainException ex) {
      throw ex;
    } catch (RuntimeException ex) {
      OperationalMetrics.increment("document-service", OperationalMetrics.Counter.REDIS_FALLBACK);
      long minute = System.currentTimeMillis() / 60000;
      if (fallback.size() > 10000)
        fallback.entrySet().removeIf(e -> e.getValue().minute() != minute);
      if (fallback.size() > 10000) throw new DomainException(429, "RATE_LIMITED");
      Counter c =
          fallback.compute(
              key,
              (k, v) ->
                  v == null || v.minute() != minute
                      ? new Counter(minute, 1)
                      : new Counter(minute, v.count() + 1));
      if (c.count() > limit) throw new DomainException(429, "RATE_LIMITED");
    }
  }

  private Semaphore stream(String ip) {
    String key = NativeCodec.sha256(ip.getBytes(StandardCharsets.UTF_8));
    if (streams.size() > 10000)
      streams.entrySet().removeIf(e -> e.getValue().availablePermits() == 2);
    Semaphore s = streams.computeIfAbsent(key, k -> new Semaphore(2));
    if (!s.tryAcquire()) throw new DomainException(429, "RATE_LIMITED");
    return s;
  }
}
