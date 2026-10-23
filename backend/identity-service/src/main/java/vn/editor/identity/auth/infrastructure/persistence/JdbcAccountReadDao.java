package vn.editor.identity.auth.infrastructure.persistence;

import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import vn.editor.identity.auth.application.port.AccountReadRepository;
import vn.editor.identity.auth.application.query.AvatarImage;
import vn.editor.identity.auth.application.query.CredentialStatus;
import vn.editor.identity.auth.application.query.UserView;
import vn.editor.identity.auth.domain.AccountEmail;

@Repository
public class JdbcAccountReadDao implements AccountReadRepository {
  private static final String PROJECTION =
      "SELECT id,email_norm,display_name,avatar_source,google_picture_url,avatar_updated_at FROM users WHERE ";
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

  @Override
  public boolean hasVerifiedEmail(String userId, AccountEmail email) {
    return jdbc.queryForObject(
            "SELECT COUNT(*) FROM google_identities WHERE user_id=? AND provider_email=?",
            Long.class,
            userId,
            email.value())
        > 0;
  }

  @Override
  public AvatarImage avatarById(String userId) {
    var images =
        jdbc.query(
            "SELECT custom_avatar,custom_avatar_mime FROM users WHERE id=? AND status='ACTIVE' AND custom_avatar IS NOT NULL",
            (row, index) ->
                new AvatarImage(row.getBytes("custom_avatar"), row.getString("custom_avatar_mime")),
            userId);
    return images.isEmpty() ? null : images.getFirst();
  }

  @Override
  public CredentialStatus credentialStatus(String userId) {
    return jdbc.queryForObject(
        "SELECT u.password_hash IS NOT NULL,(SELECT COUNT(*) FROM google_identities g WHERE g.user_id=u.id)>0 FROM users u WHERE u.id=? AND u.status='ACTIVE'",
        (row, index) -> new CredentialStatus(row.getBoolean(1), row.getBoolean(2)),
        userId);
  }

  private UserView one(String sql, String argument) {
    List<UserView> rows =
        jdbc.query(
            sql,
            (row, index) ->
                new UserView(
                    row.getString("id"),
                    row.getString("email_norm"),
                    row.getString("display_name"),
                    row.getString("avatar_source"),
                    "CUSTOM".equals(row.getString("avatar_source"))
                        ? "/api/v1/avatars/"
                            + row.getString("id")
                            + "?v="
                            + row.getTimestamp("avatar_updated_at")
                                .toString()
                                .replaceAll("[^0-9]", "")
                        : row.getString("google_picture_url")),
            argument);
    return rows.isEmpty() ? null : rows.getFirst();
  }
}
