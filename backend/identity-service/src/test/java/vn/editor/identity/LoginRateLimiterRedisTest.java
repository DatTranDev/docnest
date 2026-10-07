package vn.editor.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.util.ArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import vn.editor.identity.auth.domain.AuthenticationFailure;
import vn.editor.identity.auth.infrastructure.redis.LoginRateLimiter;
import vn.editor.identity.auth.infrastructure.security.SecureRefreshTokens;

@Testcontainers
class LoginRateLimiterRedisTest {
  @Container
  static GenericContainer<?> redis =
      new GenericContainer<>("redis:8.4.0-alpine").withExposedPorts(6379);

  @Test
  void concurrentInstancesAdmitOnlyTenAndStoreOnlyHashedIpWithTtl() throws Exception {
    var factory = new LettuceConnectionFactory(redis.getHost(), redis.getMappedPort(6379));
    factory.afterPropertiesSet();
    factory.start();
    try {
      var template = new StringRedisTemplate(factory);
      String address = "198.51.100.42", key = "rate:login:" + SecureRefreshTokens.sha256(address);
      var first = new LoginRateLimiter(template);
      var second = new LoginRateLimiter(template);
      try (var pool = Executors.newFixedThreadPool(12)) {
        var start = new CountDownLatch(1);
        var results = new ArrayList<Future<Boolean>>();
        for (int i = 0; i < 30; i++) {
          final var limiter = i % 2 == 0 ? first : second;
          results.add(
              pool.submit(
                  () -> {
                    start.await();
                    try {
                      limiter.attempt(address);
                      return true;
                    } catch (AuthenticationFailure e) {
                      assertEquals(AuthenticationFailure.Reason.RATE_LIMITED, e.reason());
                      return false;
                    }
                  }));
        }
        start.countDown();
        int admitted = 0;
        for (var result : results) if (result.get()) admitted++;
        assertEquals(10, admitted);
      }
      assertEquals("30", template.opsForValue().get(key));
      assertTrue(template.getExpire(key) > 0 && template.getExpire(key) <= 60);
      assertFalse(template.keys("rate:login:*").toString().contains(address));
      second.attempt("198.51.100.43");
      template.expire(key, Duration.ofMillis(1));
      Thread.sleep(20);
      first.attempt(address);
      assertEquals("1", template.opsForValue().get(key));
    } finally {
      factory.destroy();
    }
  }

  @Test
  void actualConnectionFailureStillLimitsLocally() {
    // Real refused TCP connection: no mock or Redis operation is substituted.
    var configuration =
        new org.springframework.data.redis.connection.RedisStandaloneConfiguration("127.0.0.1", 1);
    var client =
        org.springframework.data.redis.connection.lettuce.LettuceClientConfiguration.builder()
            .commandTimeout(Duration.ofMillis(50))
            .shutdownTimeout(Duration.ofMillis(50))
            .build();
    var factory = new LettuceConnectionFactory(configuration, client);
    factory.afterPropertiesSet();
    factory.start();
    try {
      var limiter = new LoginRateLimiter(new StringRedisTemplate(factory));
      for (int i = 0; i < 10; i++) limiter.attempt("203.0.113.1");
      assertEquals(
          AuthenticationFailure.Reason.RATE_LIMITED,
          assertThrows(AuthenticationFailure.class, () -> limiter.attempt("203.0.113.1")).reason());
      limiter.attempt("203.0.113.2");
    } finally {
      factory.destroy();
    }
  }
}
