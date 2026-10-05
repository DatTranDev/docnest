package vn.editor.processing.bootstrap;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication(scanBasePackages = "vn.editor.processing")
@EnableScheduling
public class ProcessingApplication {
  public static void main(String[] args) {
    if (java.util.Arrays.asList(args).contains("--migrate-only")
        || java.util.Arrays.asList(args).contains("--editor.migrate-only=true")) {
      MigrationRunner.run();
      return;
    }
    SpringApplication.run(ProcessingApplication.class, args);
  }
}
