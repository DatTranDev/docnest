package vn.editor.document.documents.infrastructure;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import vn.editor.document.documents.application.command.ApplyPreviewCompletionCommand;
import vn.editor.document.documents.application.port.PreviewProjection;
import vn.editor.document.documents.domain.PreviewProjectionPolicy;
import vn.editor.document.shared.infrastructure.JdbcStore;

@Repository
public class JdbcPreviewProjection extends JdbcStore implements PreviewProjection {
  public JdbcPreviewProjection(JdbcTemplate db, PlatformTransactionManager manager) {
    super(db, manager);
  }

  @Override
  public void apply(ApplyPreviewCompletionCommand command) {
    transaction(
        () -> {
          int inserted =
              db.update(
                  "INSERT IGNORE INTO inbox_receipts(consumer_name,event_id,received_at) VALUES"
                      + " ('document-preview-projection-v1',?,?)",
                  command.eventId(),
                  now());
          if (inserted == 0) return null;
          if (PreviewProjectionPolicy.eligible(command.type(), command.state(), command.summary()))
            db.update(
                "UPDATE documents SET preview_revision=?,preview_json=? WHERE id=? AND"
                    + " head_revision=? AND deleted_at IS NULL",
                command.revision(),
                encode(command.summary()),
                command.documentId(),
                command.revision());
          return null;
        });
  }
}
