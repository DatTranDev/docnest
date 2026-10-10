package vn.editor.document;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import vn.editor.common.storage.StorageProvider;
import vn.editor.document.documents.application.command.ApplyPreviewCompletionHandler;
import vn.editor.document.documents.application.command.ChangeDocumentMetadataCommand;
import vn.editor.document.documents.application.command.CreateDocumentCommand;
import vn.editor.document.documents.application.command.CreateUploadCommand;
import vn.editor.document.documents.application.command.DocumentCommandHandler;
import vn.editor.document.documents.application.command.RetentionCommandHandler;
import vn.editor.document.documents.application.command.SaveDocumentCommand;
import vn.editor.document.documents.application.command.SaveDocumentCommandHandler;
import vn.editor.document.documents.application.command.SaveResult;
import vn.editor.document.documents.application.command.TrashDocumentCommand;
import vn.editor.document.documents.application.command.UploadCommandHandler;
import vn.editor.document.documents.application.query.DocumentQueryHandler;
import vn.editor.document.documents.application.query.GetDocumentQuery;
import vn.editor.document.documents.application.query.GetVersionQuery;
import vn.editor.document.documents.application.query.ListVersionsQuery;
import vn.editor.document.documents.infrastructure.JdbcDocumentDao;
import vn.editor.document.documents.infrastructure.JdbcPreviewDao;
import vn.editor.document.documents.infrastructure.JdbcRetentionDao;
import vn.editor.document.documents.infrastructure.JdbcSaveDao;
import vn.editor.document.documents.infrastructure.NativeSnapshotValidator;
import vn.editor.document.documents.infrastructure.SnapshotStorageAdapter;
import vn.editor.document.folders.application.command.CreateFolderCommand;
import vn.editor.document.folders.application.command.DeleteFolderCommand;
import vn.editor.document.folders.application.command.FolderCommandHandler;
import vn.editor.document.folders.application.command.MoveFolderCommand;
import vn.editor.document.folders.application.query.FolderQueryHandler;
import vn.editor.document.folders.application.query.GetFolderQuery;
import vn.editor.document.folders.infrastructure.JdbcFolderDao;
import vn.editor.document.shared.domain.Values;
import vn.editor.document.sharing.application.command.CreatePublicLinkCommand;
import vn.editor.document.sharing.application.command.GrantDocumentAccessCommand;
import vn.editor.document.sharing.application.command.RevokeDocumentAccessCommand;
import vn.editor.document.sharing.application.command.RevokePublicLinkCommand;
import vn.editor.document.sharing.application.command.SharingCommandHandler;
import vn.editor.document.sharing.application.port.AccountDirectory;
import vn.editor.document.sharing.application.port.PublicTrafficLimit;
import vn.editor.document.sharing.application.query.PublicShareQueryHandler;
import vn.editor.document.sharing.application.query.SharingQueryHandler;
import vn.editor.document.sharing.infrastructure.JdbcSharingDao;

final class DocumentHarness {
  final ObjectMapper json = new ObjectMapper();
  final StorageProvider storage;
  final JdbcFolderDao folderStore;
  final FolderCommandHandler folderCommands;
  final FolderQueryHandler folderQueries;
  final DocumentCommandHandler documentCommands;
  final DocumentQueryHandler documentQueries;
  final SaveDocumentCommandHandler saves;
  final UploadCommandHandler uploads;
  final SharingCommandHandler sharingCommands;
  final SharingQueryHandler sharingQueries;
  final PublicShareQueryHandler publicShares;
  final RetentionCommandHandler retention;
  final ApplyPreviewCompletionHandler projection;

  DocumentHarness(
      JdbcTemplate db,
      PlatformTransactionManager manager,
      StorageProvider storage,
      String base,
      int docs,
      int folders) {
    this.storage = storage;
    folderStore = new JdbcFolderDao(db, manager, folders);
    JdbcDocumentDao documents = new JdbcDocumentDao(db, manager, folderStore, docs);
    JdbcSaveDao saveStore = new JdbcSaveDao(db, manager, documents);
    JdbcSharingDao sharing = new JdbcSharingDao(db, manager, documents);
    SnapshotStorageAdapter objects = new SnapshotStorageAdapter(storage);
    folderCommands = new FolderCommandHandler(folderStore);
    folderQueries = new FolderQueryHandler(folderStore);
    documentCommands = new DocumentCommandHandler(documents, folderStore);
    documentQueries = new DocumentQueryHandler(documents, live -> live, objects, base);
    saves = new SaveDocumentCommandHandler(saveStore, new NativeSnapshotValidator(objects));
    uploads = new UploadCommandHandler(saveStore, objects);
    AccountDirectory accounts =
        new AccountDirectory() {
          public Account user(String id, String authorization) {
            return new Account(id, id + "@example.com", "Test user");
          }

          public Account resolve(String email, String authorization) {
            throw new UnsupportedOperationException(
                "Identity resolution has its own HTTP acceptance gate");
          }
        };
    sharingCommands = new SharingCommandHandler(documents, sharing, accounts);
    sharingQueries = new SharingQueryHandler(sharing, accounts);
    publicShares =
        new PublicShareQueryHandler(
            sharing,
            objects,
            new PublicTrafficLimit() {
              public void take(String ip, boolean download) {}

              public Lease acquireStream(String ip) {
                return () -> {};
              }
            });
    retention = new RetentionCommandHandler(new JdbcRetentionDao(db, manager), objects);
    projection = new ApplyPreviewCompletionHandler(new JdbcPreviewDao(db, manager));
  }

  static String uuid() {
    return UUID.randomUUID().toString();
  }

  static Map<String, Object> map(Object... entries) {
    return Values.map(entries);
  }

  Map<String, Object> dto(Object value) {
    return json.convertValue(value, Map.class);
  }

  String encode(Object value) throws IOException {
    return json.writeValueAsString(value);
  }

  Map<String, Object> createFolder(String actor, Map<String, Object> body) {
    return dto(folderCommands.handle(CreateFolderCommand.from(actor, body)));
  }

  Map<String, Object> getFolder(String actor, String id) {
    return dto(folderQueries.handle(new GetFolderQuery(actor, id)));
  }

  Map<String, Object> patchFolder(String actor, String id, Map<String, Object> body) {
    return dto(folderCommands.handle(MoveFolderCommand.from(actor, id, body)));
  }

  void deleteFolder(String actor, String id, long revision) {
    folderCommands.handle(new DeleteFolderCommand(actor, id, revision));
  }

  int depth(String actor, String id) {
    return folderStore.depth(actor, id);
  }

  Map<String, Object> createDocument(String actor, Map<String, Object> body) {
    return dto(documentCommands.handle(CreateDocumentCommand.from(actor, body)));
  }

  Map<String, Object> patchDocument(String actor, String id, Map<String, Object> body) {
    return dto(documentCommands.handle(ChangeDocumentMetadataCommand.from(actor, id, body)));
  }

  Map<String, Object> document(String actor, String id) {
    return dto(documentQueries.handle(new GetDocumentQuery(actor, id)));
  }

  Map<String, Object> trash(String actor, String id, Map<String, Object> body, boolean restore) {
    return dto(documentCommands.handle(TrashDocumentCommand.from(actor, id, body, restore)));
  }

  Map<String, Object> createUpload(String actor, String id, Map<String, Object> body)
      throws IOException {
    return dto(uploads.handle(CreateUploadCommand.from(actor, id, body)));
  }

  void upload(String actor, String id, long bytes, InputStream input) throws IOException {
    uploads.upload(actor, id, bytes, input);
  }

  SaveResult commit(String actor, String document, String key, Map<String, Object> body)
      throws IOException {
    return saves.handle(SaveDocumentCommand.from(actor, document, key, body));
  }

  InputStream content(String actor, String id, long revision) throws IOException {
    return documentQueries.content(new GetVersionQuery(actor, id, revision));
  }

  Map<String, Object> download(String actor, String id, long revision) {
    return dto(documentQueries.download(new GetVersionQuery(actor, id, revision)));
  }

  Map<String, Object> versions(String actor, String id, String cursor, int limit) {
    return dto(documentQueries.handle(new ListVersionsQuery(actor, id, cursor, limit)));
  }

  Map<String, Object> grant(String actor, String doc, String grantee, String role) {
    return dto(
        sharingCommands.handle(new GrantDocumentAccessCommand(actor, doc, grantee, role, "test")));
  }

  void revoke(String actor, String doc, String grantee) {
    sharingCommands.handle(new RevokeDocumentAccessCommand(actor, doc, grantee));
  }

  Map<String, Object> createLink(String actor, String doc, Map<String, Object> body) {
    Values.fields(body, "", "expiresInSeconds");
    return dto(
        sharingCommands.handle(
            new CreatePublicLinkCommand(
                actor,
                doc,
                body.containsKey("expiresInSeconds")
                    ? Values.integer(body.get("expiresInSeconds"), 3600, 2592000)
                    : 604800)));
  }

  void revokeLink(String actor, String doc, String link) {
    sharingCommands.handle(new RevokePublicLinkCommand(actor, doc, link));
  }

  Map<String, Object> publicDocument(String token) {
    return dto(publicShares.document(token, "test"));
  }
}
