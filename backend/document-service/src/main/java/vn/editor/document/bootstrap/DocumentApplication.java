package vn.editor.document.bootstrap;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication(scanBasePackages = "vn.editor.document")
@EnableScheduling
public class DocumentApplication {
  public static void main(String[] args) {
    boolean migrations =
        java.util.Arrays.stream(args)
            .anyMatch(a -> a.equals("--editor.migrate-only=true") || a.equals("--migrate-only"));
    if (migrations) {
      String url =
          env(
              "DOCUMENT_DB_URL",
              env(
                  "DATABASE_URL",
                  "jdbc:mysql://localhost:3306/document_db?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true"));
      var source =
          new org.springframework.jdbc.datasource.DriverManagerDataSource(
              url, env("DOCUMENT_DB_USER", "document"), env("DOCUMENT_DB_PASSWORD", ""));
      org.flywaydb.core.Flyway.configure()
          .dataSource(source)
          .locations("classpath:db/migration")
          .load()
          .migrate();
      return;
    }
    SpringApplication.run(DocumentApplication.class, args);
  }

  private static String env(String name, String fallback) {
    String value = System.getenv(name);
    return value == null || value.isBlank() ? fallback : value;
  }
}
