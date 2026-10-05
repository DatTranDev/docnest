package vn.editor.document.folders.application.command;

import java.util.UUID;
import vn.editor.document.folders.application.port.FolderWritePort;
import vn.editor.document.folders.application.query.FolderView;
import vn.editor.document.folders.domain.Folder;
import vn.editor.document.folders.domain.FolderTreePolicy;
import vn.editor.document.shared.domain.Values;

public final class FolderCommandHandler {
  private final FolderWritePort folders;

  public FolderCommandHandler(FolderWritePort folders) {
    this.folders = folders;
  }

  public FolderView handle(CreateFolderCommand command) {
    return folders.execute(
        () -> {
          folders.lockWorkspace(command.actor());
          folders.requireFolder(command.actor(), command.parentId());
          FolderTreePolicy.placement(
              null, folders.ancestors(command.actor(), command.parentId()), 1);
          Values.quota(folders.count(command.actor()), folders.maximum());
          Folder folder =
              new Folder(
                  UUID.randomUUID().toString(),
                  command.actor(),
                  command.parentId(),
                  command.name(),
                  1);
          folders.insert(folder);
          folders.changed(command.actor());
          return folders.view(command.actor(), folder.id());
        });
  }

  public FolderView handle(MoveFolderCommand command) {
    return folders.execute(
        () -> {
          folders.lockWorkspace(command.actor());
          Folder current = folders.load(command.actor(), command.folderId(), true);
          String parent = command.parentChanged() ? command.parentId() : current.parentId();
          Folder moved = current.move(command.expectedMetadataRevision(), command.name(), parent);
          folders.requireFolder(command.actor(), parent);
          FolderTreePolicy.placement(
              current.id(),
              folders.ancestors(command.actor(), parent),
              folders.subtreeHeight(command.actor(), current.id()));
          folders.update(moved);
          folders.changed(command.actor());
          return folders.view(command.actor(), current.id());
        });
  }

  public void handle(DeleteFolderCommand command) {
    folders.execute(
        () -> {
          folders.lockWorkspace(command.actor());
          folders
              .load(command.actor(), command.folderId(), true)
              .requireRevision(command.expectedMetadataRevision());
          FolderTreePolicy.deletion(folders.children(command.folderId()));
          folders.delete(command.folderId());
          folders.changed(command.actor());
          return null;
        });
  }
}
