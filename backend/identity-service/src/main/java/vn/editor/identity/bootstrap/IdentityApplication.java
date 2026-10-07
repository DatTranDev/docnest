package vn.editor.identity.bootstrap;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication(scanBasePackages = "vn.editor.identity")
public class IdentityApplication {
  public static void main(String[] args) {
    if (java.util.Arrays.asList(args).contains("--migrate-only")
        || java.util.Arrays.asList(args).contains("--editor.migrate-only=true")) {
      MigrationRunner.run();
      return;
    }
    SpringApplication.run(IdentityApplication.class, args);
  }
}
