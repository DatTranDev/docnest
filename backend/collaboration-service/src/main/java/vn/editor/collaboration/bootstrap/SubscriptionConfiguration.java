package vn.editor.collaboration.bootstrap;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.config.ConcurrentKafkaListenerContainerFactory;
import org.springframework.kafka.core.ConsumerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.ContainerProperties;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.backoff.FixedBackOff;
import vn.editor.collaboration.subscriptions.application.command.ApplyEntitlementHandler;
import vn.editor.collaboration.subscriptions.application.port.EntitlementRepository;
import vn.editor.common.messaging.JdbcMessageLog;
import vn.editor.common.messaging.KafkaMessageRelay;

@Configuration
@EnableScheduling
public class SubscriptionConfiguration {
  @Bean
  org.springframework.kafka.support.ProducerListener<Object, Object> redactedProducerListener() {
    return new org.springframework.kafka.support.ProducerListener<>() {};
  }

  @Bean
  JdbcMessageLog sagaMessages(JdbcTemplate jdbc, TransactionTemplate transactions) {
    return new JdbcMessageLog(jdbc, transactions);
  }

  @Bean
  KafkaMessageRelay sagaRelay(JdbcMessageLog messages, KafkaTemplate<String, String> kafka) {
    return new KafkaMessageRelay(messages, kafka);
  }

  @Bean
  ApplyEntitlementHandler entitlementHandler(EntitlementRepository store) {
    return new ApplyEntitlementHandler(store);
  }

  @Bean
  ConcurrentKafkaListenerContainerFactory<String, String> sagaKafkaFactory(
      ConsumerFactory<String, String> consumers,
      KafkaMessageRelay relay,
      @Value("${spring.kafka.listener.auto-startup:true}") boolean autoStartup) {
    var factory = new ConcurrentKafkaListenerContainerFactory<String, String>();
    factory.setConsumerFactory(consumers);
    factory.setAutoStartup(autoStartup);
    factory.getContainerProperties().setAckMode(ContainerProperties.AckMode.MANUAL_IMMEDIATE);
    var errors =
        new DefaultErrorHandler(
            (record, error) ->
                relay.deadLetter(
                    "collaboration-service",
                    record.topic(),
                    record.key() instanceof String ? (String) record.key() : null,
                    record.value() instanceof String ? (String) record.value() : null,
                    record.partition(),
                    record.offset(),
                    true),
            new FixedBackOff(1000, 3));
    errors.setCommitRecovered(true);
    factory.setCommonErrorHandler(errors);
    return factory;
  }
}
