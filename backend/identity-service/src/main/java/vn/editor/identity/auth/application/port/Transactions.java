package vn.editor.identity.auth.application.port;

import java.util.function.Supplier;

public interface Transactions {
  <T> T execute(Supplier<T> operation);

  default void execute(Runnable operation) {
    execute(
        () -> {
          operation.run();
          return null;
        });
  }
}
