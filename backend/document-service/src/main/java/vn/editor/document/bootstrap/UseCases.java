package vn.editor.document.bootstrap;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import vn.editor.document.documents.application.command.ApplyPreviewCompletionHandler;
import vn.editor.document.documents.application.command.DocumentCommandHandler;
import vn.editor.document.documents.application.command.RelayOutboxCommandHandler;
import vn.editor.document.documents.application.command.RetentionCommandHandler;
import vn.editor.document.documents.application.command.SaveDocumentCommandHandler;
import vn.editor.document.documents.application.command.UploadCommandHandler;
import vn.editor.document.documents.application.port.DocumentAuthorization;
import vn.editor.document.documents.application.port.DocumentReadPort;
import vn.editor.document.documents.application.port.DocumentWritePort;
import vn.editor.document.documents.application.port.EventPublisher;
import vn.editor.document.documents.application.port.MetadataProjection;
import vn.editor.document.documents.application.port.OutboxRepository;
import vn.editor.document.documents.application.port.PreviewProjection;
import vn.editor.document.documents.application.port.RetentionRepository;
import vn.editor.document.documents.application.port.SaveRepository;
import vn.editor.document.documents.application.port.SnapshotStore;
import vn.editor.document.documents.application.port.SnapshotValidator;
import vn.editor.document.documents.application.query.DocumentQueryHandler;
import vn.editor.document.folders.application.command.FolderCommandHandler;
import vn.editor.document.folders.application.port.FolderReadPort;
import vn.editor.document.folders.application.port.FolderWritePort;
import vn.editor.document.folders.application.port.WorkspaceDirectory;
import vn.editor.document.folders.application.query.FolderQueryHandler;
import vn.editor.document.sharing.application.command.SharingCommandHandler;
import vn.editor.document.sharing.application.port.AccountDirectory;
import vn.editor.document.sharing.application.port.PublicTrafficLimit;
import vn.editor.document.sharing.application.port.SharingReadPort;
import vn.editor.document.sharing.application.port.SharingWritePort;
import vn.editor.document.sharing.application.query.PublicShareQueryHandler;
import vn.editor.document.sharing.application.query.SharingQueryHandler;

@Configuration
public class UseCases {
  @Bean
  FolderCommandHandler folderCommandHandler(FolderWritePort folders) {
    return new FolderCommandHandler(folders);
  }

  @Bean
  FolderQueryHandler folderQueryHandler(FolderReadPort folders) {
    return new FolderQueryHandler(folders);
  }

  @Bean
  DocumentCommandHandler documentCommandHandler(
      DocumentWritePort documents, WorkspaceDirectory folders) {
    return new DocumentCommandHandler(documents, folders);
  }

  @Bean
  DocumentQueryHandler documentQueryHandler(
      DocumentReadPort documents,
      MetadataProjection cache,
      SnapshotStore storage,
      @Value("${editor.public-base-url:http://localhost:8080}") String base) {
    return new DocumentQueryHandler(documents, cache, storage, base);
  }

  @Bean
  SaveDocumentCommandHandler saveDocumentCommandHandler(
      SaveRepository saves, SnapshotValidator validator) {
    return new SaveDocumentCommandHandler(saves, validator);
  }

  @Bean
  UploadCommandHandler uploadCommandHandler(SaveRepository saves, SnapshotStore storage) {
    return new UploadCommandHandler(saves, storage);
  }

  @Bean
  RetentionCommandHandler retentionCommandHandler(
      RetentionRepository retention, SnapshotStore storage) {
    return new RetentionCommandHandler(retention, storage);
  }

  @Bean
  ApplyPreviewCompletionHandler applyPreviewCompletionHandler(PreviewProjection projection) {
    return new ApplyPreviewCompletionHandler(projection);
  }

  @Bean
  SharingCommandHandler sharingCommandHandler(
      DocumentAuthorization documents, SharingWritePort sharing, AccountDirectory accounts) {
    return new SharingCommandHandler(documents, sharing, accounts);
  }

  @Bean
  SharingQueryHandler sharingQueryHandler(SharingReadPort sharing, AccountDirectory accounts) {
    return new SharingQueryHandler(sharing, accounts);
  }

  @Bean
  PublicShareQueryHandler publicShareQueryHandler(
      SharingReadPort sharing, SnapshotStore storage, PublicTrafficLimit traffic) {
    return new PublicShareQueryHandler(sharing, storage, traffic);
  }

  @Bean
  RelayOutboxCommandHandler relayOutboxCommandHandler(
      OutboxRepository outbox, EventPublisher publisher) {
    return new RelayOutboxCommandHandler(outbox, publisher);
  }
}
