package vn.editor.payment.bootstrap;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication(scanBasePackages = "vn.editor.payment")
public class PaymentApplication {
  public static void main(String[] args) {
    if (java.util.Arrays.asList(args).contains("--migrate-only")
        || java.util.Arrays.asList(args).contains("--editor.migrate-only=true")) {
      MigrationRunner.run();
      return;
    }
    SpringApplication.run(PaymentApplication.class, args);
  }
}
