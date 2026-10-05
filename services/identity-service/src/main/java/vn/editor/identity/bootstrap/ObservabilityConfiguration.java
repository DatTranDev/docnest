package vn.editor.identity.bootstrap;

import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import vn.editor.common.observability.RequestObservationFilter;

@Configuration
public class ObservabilityConfiguration {
  @Bean
  public FilterRegistrationBean<RequestObservationFilter> requestObservation(
      MeterRegistry metrics) {
    var registration =
        new FilterRegistrationBean<>(new RequestObservationFilter("identity-service", metrics));
    registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
    return registration;
  }
}
