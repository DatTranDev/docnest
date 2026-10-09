package vn.editor.payment.bootstrap;

final class MigrationRunner {
  static void run() {
    String url = value("PAYMENT_DB_URL", "SPRING_DATASOURCE_URL"),
        user = value("PAYMENT_DB_USER", "SPRING_DATASOURCE_USERNAME"),
        password = value("PAYMENT_DB_PASSWORD", "SPRING_DATASOURCE_PASSWORD");
    org.flywaydb.core.Flyway.configure()
        .dataSource(url, user, password)
        .locations("classpath:db/migration")
        .load()
        .migrate();
  }

  private static String value(String first, String second) {
    String v = System.getenv(first);
    if (v == null || v.isBlank()) v = System.getenv(second);
    if (v == null || v.isBlank())
      throw new IllegalStateException("Migration configuration missing: " + first);
    return v;
  }

  private MigrationRunner() {}
}
