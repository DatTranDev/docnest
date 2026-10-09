package vn.editor.payment.billing.infrastructure;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public final class BillingBodyLimit extends OncePerRequestFilter {
  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    if (!request.getMethod().equals("POST")
        || !request.getRequestURI().startsWith("/api/v1/billing/")) {
      chain.doFilter(request, response);
      return;
    }
    int limit = request.getRequestURI().equals("/api/v1/billing/webhooks/stripe") ? 1048576 : 8192;
    if (request.getContentLengthLong() > limit) {
      reject(response);
      return;
    }
    byte[] bytes = request.getInputStream().readNBytes(limit + 1);
    if (bytes.length > limit) {
      reject(response);
      return;
    }
    chain.doFilter(
        new HttpServletRequestWrapper(request) {
          @Override
          public ServletInputStream getInputStream() {
            var input = new ByteArrayInputStream(bytes);
            return new ServletInputStream() {
              @Override
              public int read() {
                return input.read();
              }

              @Override
              public int read(byte[] buffer, int offset, int length) {
                return input.read(buffer, offset, length);
              }

              @Override
              public boolean isFinished() {
                return input.available() == 0;
              }

              @Override
              public boolean isReady() {
                return true;
              }

              @Override
              public void setReadListener(ReadListener listener) {
                throw new IllegalStateException("ASYNC_BILLING_BODY_UNSUPPORTED");
              }
            };
          }
        },
        response);
  }

  private static void reject(HttpServletResponse response) throws IOException {
    response.setStatus(413);
    response.setContentType("application/json");
    response.setHeader("Cache-Control", "private, no-store");
    response
        .getWriter()
        .write(
            "{\"code\":\"BILLING_BODY_LIMIT\",\"message\":\"BILLING_BODY_LIMIT\",\"details\":{}}");
  }
}
