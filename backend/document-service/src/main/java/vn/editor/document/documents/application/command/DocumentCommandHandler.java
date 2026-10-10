package vn.editor.document.documents.application.command;

import java.time.Instant;
import java.util.UUID;
import vn.editor.document.documents.application.port.DocumentWriteRepository;
import vn.editor.document.documents.application.query.DocumentView;
import vn.editor.document.documents.domain.Document;
import vn.editor.document.folders.application.port.WorkspaceDirectory;
import vn.editor.document.shared.domain.Values;

public final class DocumentCommandHandler implements DocumentCommandService {
  private final DocumentWriteRepository documents;
  private final WorkspaceDirectory folders;

  public DocumentCommandHandler(DocumentWriteRepository documents, WorkspaceDirectory folders) {
    this.documents = documents;
    this.folders = folders;
  }

  public DocumentView handle(CreateDocumentCommand command) {
    return documents.execute(
        () -> {
          folders.lockWorkspace(command.actor());
          folders.requireFolder(command.actor(), command.folderId());
          Values.quota(documents.count(command.actor()), documents.maximum());
          String id = UUID.randomUUID().toString();
          documents.insert(command.actor(), id, command.title(), command.folderId());
          return documents.view(command.actor(), id);
        });
  }

  public DocumentView handle(ChangeDocumentMetadataCommand command) {
    return documents.execute(
        () -> {
          folders.lockWorkspace(command.actor());
          Document current = documents.load(command.actor(), command.documentId(), false);
          String folder = command.folderChanged() ? command.folderId() : current.folderId();
          Document changed =
              current.metadata(command.expectedMetadataRevision(), command.title(), folder);
          folders.requireFolder(command.actor(), folder);
          documents.updateMetadata(changed);
          return documents.view(command.actor(), current.id());
        });
  }

  public DocumentView handle(TrashDocumentCommand command) {
    return documents.execute(
        () -> {
          folders.lockWorkspace(command.actor());
          Document current = documents.load(command.actor(), command.documentId(), true);
          current.requireMetadataMutation(command.expectedMetadataRevision());
          if (command.restore()) {
            current.requireRestorable(Instant.now());
            String folder = current.restoreFolderId();
            if (folder != null && !folders.folderExists(command.actor(), folder)) folder = null;
            documents.restore(current.id(), folder);
          } else if (current.deletedAt() == null) documents.markTrash(current.id());
          return documents.view(command.actor(), current.id());
        });
  }
}
