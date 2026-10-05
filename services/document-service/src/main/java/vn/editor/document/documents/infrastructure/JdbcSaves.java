package vn.editor.document.documents.infrastructure;

import static vn.editor.document.shared.domain.Values.id;
import static vn.editor.document.shared.domain.Values.map;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import vn.editor.common.observability.TraceContext;
import vn.editor.document.documents.application.command.CreateUploadCommand;
import vn.editor.document.documents.application.command.SaveDocumentCommand;
import vn.editor.document.documents.application.command.SaveResult;
import vn.editor.document.documents.application.port.DocumentAuthorization;
import vn.editor.document.documents.application.port.SaveRepository;
import vn.editor.document.documents.application.port.SnapshotStore;
import vn.editor.document.documents.domain.Document;
import vn.editor.document.documents.domain.RetentionPolicy;
import vn.editor.document.documents.domain.UploadPolicy;
import vn.editor.document.documents.domain.UploadTicket;
import vn.editor.document.documents.domain.ValidatedSnapshot;
import vn.editor.document.documents.domain.VersionCommitPolicy;
import vn.editor.document.shared.domain.DomainException;
import vn.editor.document.shared.domain.Values;
import vn.editor.document.shared.infrastructure.JdbcStore;

@Repository
public class JdbcSaves extends JdbcStore implements SaveRepository {
  private final DocumentAuthorization authorization;

  public JdbcSaves(
      JdbcTemplate db, PlatformTransactionManager manager, DocumentAuthorization authorization) {
    super(db, manager);
    this.authorization = authorization;
  }

  @Override
  public void reserve(
      CreateUploadCommand command,
      String upload,
      String key,
      String provider,
      String bucket,
      Instant expiry) {
    transaction(
        () -> {
          authorizeWrite(command.actor(), command.documentId());
          Values.quota(
              db.queryForObject(
                  "SELECT COUNT(*) FROM upload_sessions WHERE actor_user_id=? AND state NOT IN"
                      + " ('COMMITTED','ABANDONED') AND expires_at>?",
                  Integer.class,
                  command.actor(),
                  now()),
              UploadPolicy.MAX_PENDING_UPLOADS);
          db.update(
              "INSERT INTO"
                  + " upload_sessions(id,document_id,actor_user_id,expected_head_revision,expected_sha256,expected_native_bytes,storage_provider,storage_bucket,object_key,state,created_at,expires_at)"
                  + " VALUES (?,?,?,?,?,?,?,?,?,'CREATED',?,?)",
              upload,
              command.documentId(),
              command.actor(),
              command.expectedHeadRevision(),
              command.nativeSha256(),
              command.nativeBytes(),
              provider,
              bucket,
              key,
              now(),
              Timestamp.from(expiry));
          return null;
        });
  }

  @Override
  public void abandon(String upload) {
    db.update("UPDATE upload_sessions SET state='ABANDONED' WHERE id=?", upload);
  }

  @Override
  public void registerResumable(String upload, String uri) {
    db.update("UPDATE upload_sessions SET resumable_uri=? WHERE id=?", uri, upload);
  }

  @Override
  public void authorizeWrite(String actor, String document) {
    Document row = authorization.authorize(actor, document, txActive(), false);
    row.access().requireEditor();
  }

  private boolean txActive() {
    return org.springframework.transaction.support.TransactionSynchronizationManager
        .isActualTransactionActive();
  }

  @Override
  public UploadTicket ticket(String actor, String upload) {
    return ticketValue(ticketRow(actor, upload));
  }

  @Override
  public void markUploaded(String upload, String generation) {
    db.update(
        "UPDATE upload_sessions SET state='UPLOADED',object_generation=? WHERE id=? AND"
            + " state='CREATED'",
        generation,
        upload);
  }

  @Override
  public SaveResult prior(SaveDocumentCommand command, String fingerprint) {
    return transaction(
        () -> {
          authorizeWrite(command.actor(), command.documentId());
          return idempotency(command.actor(), command.idempotencyKey(), fingerprint);
        });
  }

  @Override
  public UploadTicket claim(SaveDocumentCommand command, String lease) {
    return transaction(
        () -> {
          Map<String, Object> row = ticketRow(command.actor(), command.uploadId());
          UploadTicket ticket = ticketValue(row);
          ticket.requireBinding(command.documentId(), command.expectedHeadRevision());
          ticket.requireUnexpired(Instant.now());
          ticket.requireValidatable();
          if (db.update(
                  "UPDATE upload_sessions SET"
                      + " state='VALIDATING',validation_lease_owner=?,validation_lease_until=?"
                      + " WHERE id=? AND (state IN ('CREATED','UPLOADED','VALIDATED') OR"
                      + " (state='VALIDATING' AND validation_lease_until<?))",
                  lease,
                  Timestamp.from(Instant.now().plusSeconds(UploadPolicy.VALIDATION_LEASE_SECONDS)),
                  command.uploadId(),
                  now())
              != 1) throw new DomainException(409, "UPLOAD_VALIDATING");
          return ticket;
        });
  }

  @Override
  public void validated(
      String upload, String lease, ValidatedSnapshot snapshot, String generation) {
    if (db.update(
            "UPDATE upload_sessions SET"
                + " state='VALIDATED',validated_manifest=?,object_generation=?,validation_lease_until=NULL"
                + " WHERE id=? AND state='VALIDATING' AND validation_lease_owner=?",
            encode(snapshot.manifest()),
            generation,
            upload,
            lease)
        != 1) throw new DomainException(409, "UPLOAD_STATE_CONFLICT");
  }

  @Override
  public void releaseValidation(String upload, String lease) {
    db.update(
        "UPDATE upload_sessions SET"
            + " state='UPLOADED',validation_lease_until=NULL,validation_lease_owner=NULL WHERE id=?"
            + " AND validation_lease_owner=?",
        upload,
        lease);
  }

  @Override
  public SaveResult finish(
      SaveDocumentCommand command,
      String hash,
      String lease,
      ValidatedSnapshot result,
      SnapshotStore.Metadata object) {
    String actor = command.actor(),
        document = command.documentId(),
        key = command.idempotencyKey(),
        upload = command.uploadId();
    long expected = command.expectedHeadRevision();
    return transaction(
        () -> {
          Document d = authorization.authorize(actor, document, true, false);
          d.access().requireEditor();
          SaveResult retry = idempotency(actor, key, hash);
          if (retry != null) return retry;
          Map<String, Object> r = ticketRow(actor, upload);
          ticketExpiry(r);
          if (!r.get("state").equals("VALIDATED")
              || !Objects.equals(r.get("validation_lease_owner"), lease))
            throw new DomainException(409, "UPLOAD_STATE_CONFLICT");
          long head = d.headRevision();
          VersionCommitPolicy.requireExpectedHead(head, expected);
          Map<String, Object> headVersion =
              head == 0
                  ? null
                  : one("SELECT * FROM document_versions WHERE id=?", d.headVersionId());
          boolean unchanged =
              VersionCommitPolicy.unchanged(
                  headVersion == null ? null : headVersion.get("native_sha256").toString(),
                  result.nativeSha256());
          String version = unchanged ? (String) headVersion.get("id") : uuid();
          long rev = unchanged ? head : head + 1;
          int status = unchanged ? 200 : 201;
          Timestamp n = now();
          if (!unchanged) {
            Map<String, Object> m = result.manifest();
            db.update(
                "INSERT INTO"
                    + " document_versions(id,document_id,revision,storage_provider,storage_bucket,object_key,object_generation,native_sha256,native_bytes,text_utf8_bytes,utf16_length,logical_lines,created_by_user_id,created_at,last_access_at)"
                    + " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                version,
                document,
                rev,
                object.ref().provider(),
                object.ref().bucket(),
                object.ref().key(),
                object.ref().generation(),
                result.nativeSha256(),
                result.nativeBytes(),
                m.get("utf8Bytes"),
                m.get("utf16Length"),
                m.get("logicalLines"),
                actor,
                n,
                n);
            db.update(
                "UPDATE documents SET"
                    + " head_revision=?,head_version_id=?,preview_json=NULL,preview_revision=NULL,updated_at=?"
                    + " WHERE id=?",
                rev,
                version,
                n,
                document);
            Map<String, Object> payload =
                map(
                    "documentId",
                    document,
                    "versionId",
                    version,
                    "revision",
                    rev,
                    "ownerUserId",
                    d.ownerUserId(),
                    "actorUserId",
                    actor,
                    "objectRef",
                    object.ref(),
                    "nativeSha256",
                    result.nativeSha256(),
                    "nativeBytes",
                    result.nativeBytes(),
                    "textUtf8Bytes",
                    m.get("utf8Bytes"),
                    "utf16Length",
                    m.get("utf16Length"),
                    "logicalLines",
                    m.get("logicalLines"));
            String event = uuid();
            Map<String, Object> envelope =
                map(
                    "eventId",
                    event,
                    "eventType",
                    "DocumentVersionSaved",
                    "schemaVersion",
                    1,
                    "occurredAt",
                    n.toInstant().toString(),
                    "producer",
                    "document-service",
                    "traceId",
                    TraceContext.traceId(),
                    "payload",
                    payload);
            db.update(
                "INSERT INTO"
                    + " outbox_events(event_id,aggregate_id,aggregate_revision,topic,event_key,payload,created_at,next_attempt_at)"
                    + " VALUES (?,?,?,?,?,?,?,?)",
                event,
                document,
                rev,
                "document.version.saved.v1",
                document,
                encode(envelope),
                n,
                n);
            db.update(
                "UPDATE document_versions SET retired_at=? WHERE document_id=? AND retired_at IS"
                    + " NULL AND revision<=? AND id<>?",
                n,
                document,
                Math.max(0, rev - RetentionPolicy.LIVE_VERSIONS),
                version);
          }
          db.update(
              "UPDATE upload_sessions SET"
                  + " state=?,committed_version_id=?,validation_lease_owner=NULL WHERE id=?",
              unchanged ? "ABANDONED" : "COMMITTED",
              unchanged ? null : version,
              upload);
          Map<String, Object> response =
              map(
                  "version",
                  versionDto(one("SELECT * FROM document_versions WHERE id=?", version)),
                  "noChange",
                  unchanged);
          db.update(
              "INSERT INTO"
                  + " idempotency_requests(actor_user_id,operation_key,idempotency_key,request_sha256,response_status,response_body,created_at,expires_at)"
                  + " VALUES (?,'commitVersion',?,?,?,?,?,?)",
              actor,
              key,
              hash,
              status,
              encode(response),
              n,
              Timestamp.from(Instant.now().plusSeconds(RetentionPolicy.IDEMPOTENCY_SECONDS)));
          return new SaveResult(status, response);
        });
  }

  SaveResult idempotency(String actor, String key, String hash) {
    Map<String, Object> r =
        one(
            "SELECT * FROM idempotency_requests WHERE actor_user_id=? AND"
                + " operation_key='commitVersion' AND idempotency_key=?",
            actor,
            key);
    if (r == null) return null;
    if (!r.get("request_sha256").equals(hash))
      throw new DomainException(409, "IDEMPOTENCY_KEY_REUSED");
    return new SaveResult(
        ((Number) r.get("response_status")).intValue(), parse(r.get("response_body").toString()));
  }

  Map<String, Object> ticketRow(String actor, String upload) {
    Map<String, Object> r =
        one("SELECT * FROM upload_sessions WHERE id=? AND actor_user_id=?", id(upload), actor);
    if (r == null) throw new DomainException(404, "UPLOAD_NOT_FOUND");
    return r;
  }

  void ticketExpiry(Map<String, Object> r) {
    ticketValue(r).requireUnexpired(Instant.now());
  }

  Map<String, Object> versionDto(Map<String, Object> r) {
    return map(
        "id",
        r.get("id"),
        "documentId",
        r.get("document_id"),
        "revision",
        r.get("revision"),
        "nativeSha256",
        r.get("native_sha256"),
        "nativeBytes",
        r.get("native_bytes"),
        "textUtf8Bytes",
        r.get("text_utf8_bytes"),
        "utf16Length",
        r.get("utf16_length"),
        "logicalLines",
        r.get("logical_lines"),
        "createdByUserId",
        r.get("created_by_user_id"),
        "createdAt",
        time(r.get("created_at")));
  }

  private static UploadTicket ticketValue(Map<String, Object> row) {
    return new UploadTicket(
        row.get("id").toString(),
        row.get("document_id").toString(),
        row.get("object_key").toString(),
        row.get("storage_provider").toString(),
        (String) row.get("storage_bucket"),
        row.get("state").toString(),
        ((Number) row.get("expected_head_revision")).longValue(),
        ((Number) row.get("expected_native_bytes")).longValue(),
        row.get("expected_sha256").toString(),
        timestamp(row.get("expires_at")).toInstant());
  }
}
