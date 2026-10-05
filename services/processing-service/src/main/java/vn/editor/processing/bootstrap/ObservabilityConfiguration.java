package vn.editor.processing.bootstrap;

import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import vn.editor.common.observability.RequestObservationFilter;

@Configuration
public class ObservabilityConfiguration {
  @Bean
  public static org.springframework.beans.factory.config.BeanPostProcessor kafkaClientMetrics(
      MeterRegistry metrics) {
    return new org.springframework.beans.factory.config.BeanPostProcessor() {
      @Override
      public Object postProcessAfterInitialization(Object bean, String name) {
        if (bean
            instanceof org.springframework.kafka.core.DefaultKafkaConsumerFactory<?, ?> factory)
          factory.addListener(
              new org.springframework.kafka.core.MicrometerConsumerListener<>(metrics));
        if (bean
            instanceof org.springframework.kafka.core.DefaultKafkaProducerFactory<?, ?> factory)
          factory.addListener(
              new org.springframework.kafka.core.MicrometerProducerListener<>(metrics));
        return bean;
      }
    };
  }

  @Bean
  public FilterRegistrationBean<RequestObservationFilter> requestObservation(
      MeterRegistry metrics) {
    var registration =
        new FilterRegistrationBean<>(new RequestObservationFilter("processing-service", metrics));
    registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
    return registration;
  }
}
