package vn.editor.identity.auth.infrastructure.persistence;

import java.util.function.Supplier;
import org.springframework.transaction.support.TransactionTemplate;
import vn.editor.identity.auth.application.port.Transactions;

public final class SpringTransactions implements Transactions {
  private final TransactionTemplate transactions;

  public SpringTransactions(TransactionTemplate transactions) {
    this.transactions = transactions;
  }

  @Override
  public <T> T execute(Supplier<T> operation) {
    return transactions.execute(status -> operation.get());
  }
}
