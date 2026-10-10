package vn.editor.identity.auth.infrastructure.persistence;

import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import vn.editor.identity.auth.application.port.AccountReadRepository;
import vn.editor.identity.auth.application.query.UserView;
import vn.editor.identity.auth.domain.AccountEmail;

@Repository
public class JdbcAccountReadDao implements AccountReadRepository {
  private static final String PROJECTION = "SELECT id,email_norm,display_name FROM users WHERE ";
  private final JdbcTemplate jdbc;

  public JdbcAccountReadDao(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public UserView activeById(String id) {
    return one(PROJECTION + "id=? AND status='ACTIVE'", id);
  }

  @Override
  public UserView activeByEmail(AccountEmail email) {
    return one(PROJECTION + "email_norm=? AND status='ACTIVE'", email.value());
  }

  private UserView one(String sql, String argument) {
    List<UserView> rows =
        jdbc.query(
            sql,
            (row, index) ->
                new UserView(
                    row.getString("id"),
                    row.getString("email_norm"),
                    row.getString("display_name")),
            argument);
    return rows.isEmpty() ? null : rows.getFirst();
  }
}
