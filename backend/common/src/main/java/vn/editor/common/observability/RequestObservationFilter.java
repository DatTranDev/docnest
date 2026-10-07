package vn.editor.common.observability;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Runs before security, emits safe structured scalars, and returns correlation headers. */
public final class RequestObservationFilter implements Filter {
  private static final Pattern DOCUMENT = Pattern.compile("/documents/([0-9a-f-]{36})(?:/|$)");
  private static final Pattern JOB = Pattern.compile("/jobs/([0-9a-f-]{36})(?:/|$)");
  private static final Pattern REVISION = Pattern.compile("/versions/([0-9]{1,18})(?:/|$)");
  private final String service;
  private final MeterRegistry metrics;

  public RequestObservationFilter(String service, MeterRegistry metrics) {
    this.service = service;
    this.metrics = metrics;
  }

  @Override
  public void doFilter(ServletRequest input, ServletResponse output, FilterChain chain)
      throws IOException, ServletException {
    if (!(input instanceof HttpServletRequest request)
        || !(output instanceof HttpServletResponse response)) {
      chain.doFilter(input, output);
      return;
    }
    String trace =
        TraceContext.incoming(request.getHeader("traceparent"), request.getHeader("X-Trace-Id"));
    long start = System.nanoTime();
    int status = 500;
    try (TraceContext.Scope scope = TraceContext.open(trace, request.getHeader("X-Request-Id"))) {
      response.setHeader("X-Trace-Id", trace);
      response.setHeader("X-Request-Id", TraceContext.requestId());
      try {
        chain.doFilter(input, output);
        status = response.getStatus();
      } finally {
        long elapsed = System.nanoTime() - start;
        String path = request.getRequestURI();
        String revision = extract(REVISION, path);
        SafeLog.record(
            service,
            SafeLog.Action.HTTP_REQUEST,
            extract(DOCUMENT, path),
            extract(JOB, path),
            null,
            revision == null ? null : Long.parseLong(revision),
            TimeUnit.NANOSECONDS.toMillis(elapsed),
            status);
        Timer.builder("editor.http.duration")
            .tag("service", service)
            .tag("method", method(request.getMethod()))
            .tag("status", Integer.toString(status))
            .register(metrics)
            .record(elapsed, TimeUnit.NANOSECONDS);
        if (status == 409
            && path != null
            && path.matches("/api/v1/documents/[0-9a-f-]{36}/versions")
            && "POST".equals(request.getMethod()))
          metrics.counter("editor.save.conflict", "service", service).increment();
        if (status == 422 || status == 413)
          metrics.counter("editor.validation.fail", "service", service).increment();
      }
    }
  }

  private static String extract(Pattern pattern, String path) {
    Matcher match = pattern.matcher(path == null ? "" : path);
    return match.find() ? match.group(1) : null;
  }

  private static String method(String method) {
    return method != null && method.matches("GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS")
        ? method
        : "OTHER";
  }
}
