package vn.editor.collaboration.bootstrap;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication(scanBasePackages = "vn.editor.collaboration")
public class CollaborationApplication {
  public static void main(String[] args) {
    if (java.util.Arrays.asList(args).contains("--migrate-only")
        || java.util.Arrays.asList(args).contains("--editor.migrate-only=true")) {
      MigrationRunner.run();
      return;
    }
    SpringApplication.run(CollaborationApplication.class, args);
  }
}
