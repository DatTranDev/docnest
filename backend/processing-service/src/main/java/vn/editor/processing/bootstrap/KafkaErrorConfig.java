package vn.editor.processing.bootstrap;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.util.backoff.FixedBackOff;

@Configuration
public class KafkaErrorConfig {
  @jakarta.annotation.PostConstruct
  public void safeRecordFormatters() {
    org.springframework.kafka.support.KafkaUtils.setProducerRecordFormatter(
        record -> record.topic() + "-" + record.partition());
    org.springframework.kafka.support.KafkaUtils.setConsumerRecordFormatter(
        record -> record.topic() + "-" + record.partition() + "@" + record.offset());
  }

  @Bean
  org.springframework.kafka.support.ProducerListener<Object, Object> kafkaProducerListener() {
    return new org.springframework.kafka.support.ProducerListener<>() {};
  }

  @Bean
  public DefaultErrorHandler kafkaErrorHandler() {
    // The listener retries database work and ACKs only after a durable DLQ publish.
    // An outer error therefore means the DLQ is unavailable: retain the original indefinitely.
    DefaultErrorHandler handler =
        new DefaultErrorHandler(
            (record, error) -> {
              throw new org.springframework.kafka.KafkaException("DLQ_UNAVAILABLE");
            },
            new FixedBackOff(1000, FixedBackOff.UNLIMITED_ATTEMPTS));
    handler.setAckAfterHandle(false);
    handler.setCommitRecovered(false);
    return handler;
  }
}
