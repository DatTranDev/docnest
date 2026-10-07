package vn.editor.processing.jobs.infrastructure;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.dao.annotation.PersistenceExceptionTranslationPostProcessor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

/** Uses the production persistence proxy mode while keeping real MySQL and Kafka test services. */
final class ProcessingRepositoryContext {
  static AnnotationConfigApplicationContext create(
      JdbcTemplate db, TransactionTemplate tx, ProcessingEvents events, ObjectMapper json) {
    var context = new AnnotationConfigApplicationContext();
    context.registerBean(
        PersistenceExceptionTranslationPostProcessor.class,
        () -> {
          var translation = new PersistenceExceptionTranslationPostProcessor();
          translation.setProxyTargetClass(true);
          return translation;
        });
    context.registerBean(JdbcTemplate.class, () -> db);
    context.registerBean(TransactionTemplate.class, () -> tx);
    context.registerBean(ProcessingEvents.class, () -> events);
    context.registerBean(ObjectMapper.class, () -> json);
    context.registerBean(
        JdbcJobRepository.class, () -> new JdbcJobRepository(db, tx, events, json, 5));
    context.registerBean(JdbcJobExecutionRepository.class);
    context.registerBean(JdbcJobOutputCleanupRepository.class);
    context.refresh();
    return context;
  }

  private ProcessingRepositoryContext() {}
}
