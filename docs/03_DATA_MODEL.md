# Databases and transactions

The local lab uses one MySQL instance with identity_db, document_db, processing_db, collaboration_db and payment_db (ADR027/ADR028). Each service has a database user restricted to its own database. Flyway has DDL permission in that database. IDs are canonical lowercase UUIDs stored as ASCII CHAR(36); timestamps use UTC DATETIME(6). Do not create foreign keys across databases.

## identity_db

| Table            | Responsibility and constraints                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| users            | UNIQUE email_norm, password_hash, display_name, status and timestamps                             |
| refresh_sessions | UNIQUE SHA256 token hash; family_id, expires_at, used_at, revoked_at; rotate within a transaction |

Use Argon2id with at least 19 MiB of memory, 2 iterations and parallelism 1. The hash format includes the salt and parameters. Refresh tokens contain 32 random bytes encoded as base64url; store only SHA256, not the raw token. Keep the RS256 JWT key in secret/config storage, never in users or source code.

## document_db

| Table                | Responsibility                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| owner_workspaces     | One row per owner; a lock serializes folder-tree mutations and quota checks                                              |
| folders              | Adjacency tree, nullable parent_id, metadata_revision and unique sibling names                                           |
| documents            | Owner, folder, title, head_revision, head_version_id, metadata_revision, trash and preview projection                    |
| document_versions    | Immutable snapshots, UNIQUE revision per document, GCS generation, hash, byte/line counts, created_by and last_access_at |
| document_permissions | UNIQUE document + grantee; VIEWER/EDITOR role; the owner has no grant here                                               |
| share_links          | UNIQUE token hash, expiry and revoked_at; no EDITOR permission                                                           |
| upload_sessions      | Server-issued object path, actor, expected head, hash/size claim, validation/commit state and TTL                        |
| idempotency_requests | UNIQUE actor + operation + key; body hash and response committed atomically with the mutation                            |
| outbox_events        | UNIQUE event ID, aggregate, payload, publish lease/retry and auto-increment ID                                           |
| inbox_receipts       | UNIQUE consumer + event ID for the projection receiving Processing completion events                                     |

headRevision=0 represents a document without a snapshot. headVersionId=null, and the client creates empty content. There is no document_versions row for revision 0. The first save creates revision 1. Renaming, moving, trashing and restoring increment only metadataRevision. Documents may have identical titles and distinct IDs.

A root folder has parent_id NULL. MySQL UNIQUE constraints on NULL do not prevent duplicate root names. Therefore, parent_key is generated from parent_id or the zero UUID and used in UNIQUE(owner_user_id,parent_key,name_norm). The composite FK(owner_user_id,parent_id) prevents a parent with another owner. Normalize names to NFC and use case-insensitive, accent-sensitive comparison. Do not normalize document content to NFC.

## processing_db

| Table                | Responsibility                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| requester_queues     | One row per requester to serialize job quotas within a transaction                                                        |
| jobs                 | PREVIEW/EXPORT_TXT/EXPORT_HTML type; immutable snapshot reference; requester; state, attempts, lease, deadline and output |
| inbox_receipts       | Deduplicate events in the same transaction that makes a job READY or creates a PREVIEW                                    |
| outbox_events        | Job requested/completed events with publication retries                                                                   |
| idempotency_requests | Deduplicate POST jobs using user, body hash and response                                                                  |

Job states are QUEUED, READY, RUNNING, SUCCEEDED, FAILED and CANCELLED. Increment attempts when claiming a run. The lease is 60 seconds with a heartbeat every 15 seconds; scan expired leases every 10 seconds. The deadline is 15 minutes from created_at, and an attempt runs for at most 120 seconds. Export output is limited to 64 MiB and expires after 24 hours. System PREVIEW jobs use the owner from the event as requester and do not appear in the user's export list.

## Critical transactions

### Folder mutations

UPSERT owner_workspaces if absent, then SELECT that row FOR UPDATE. Verify the parent belongs to the owner and check cycles and the entire subtree's depth after a move. Lock the folder being changed and check expectedMetadataRevision. Create, move, rename or delete the folder and increment tree_revision in the same transaction. Delete only folders with no child folders or active documents; trashed documents have already been detached. Do not hold the transaction while calling another service.

### Saving

Parse and validate the object outside the SQL transaction, then use CAS to set the ticket to VALIDATED. Inside the transaction: SELECT documents FOR UPDATE; reject trash and check the current owner or EDITOR grant; check idempotency; verify the ticket's actor, document, TTL and validated generation; compare expectedHeadRevision; insert document_versions with revision=head+1; update the head; insert the outbox; mark the ticket COMMITTED; and store the idempotency response. Return 201 only after commit. A stale base returns 409 without creating a version or event.

Grant, revoke, link and trash operations also lock the document row before mutation so they serialize with a save commit. No distributed transaction with Identity is required: resolve the email internally before entering the Document transaction and store the stable grantee user ID.

### Creating an export

Processing forwards the requester's access token to Document to obtain a download descriptor. Document checks the ACL and touches last_access_at within a short transaction. Processing receives a server-issued objectRef and creates a QUEUED job, a JobRequested outbox event and an idempotency record in processing_db. Failure to create the job does not change the input file. The request body must not accept a storage path.

### Retention and garbage collection

Retain at most 20 published versions, including the head. Mark older versions with retire_at when the limit is exceeded and stop issuing new descriptors for them. Delete the physical object only after a one-hour grace period from both last_access_at and retired_at. This exceeds the 15-minute job deadline and 60-second GET URL lifetime. Retired tombstones may remain temporarily but are absent from version lists.

GC selects and locks a version before retiring it, then rechecks the head and last_access_at. Mark cleanup_pending, commit SQL, delete the object with a generation precondition, and then mark or delete the record. Do not delete the row until the object has been deleted or confirmed absent. Always retain the head. Expired uncommitted uploads become ABANDONED; cancel resumable sessions where applicable and clean objects after one hour. Never touch COMMITTED paths or versions through orphan cleanup. Purge trash after 14 days and the active-read grace period. Delete grants, links, uploads and versions through their owning service. Processing removes output after 24 hours using generation preconditions.

## Indexes and pagination

Folder lists use owner,parent_key,name_norm,id. Document lists use owner,deleted_at,folder_id,created_at,id. Shared with me starts from grantee_user_id,document_id and joins documents within the same database. Versions use document_id,revision DESC; outbox uses published_at,next_attempt_at,id; jobs use state,next_attempt_at,lease_until. Keyset cursors use created_at,id for documents and jobs, and revision for versions. Do not OFFSET through millions of records. Use validated opaque base64url JSON cursors. The limit is 1..100, default 50.

SQL in schema provides initial V1 migrations with check constraints and internal foreign keys. P02/P04 require JUnit/Testcontainers tests against real MySQL to verify collation, generated columns, foreign keys, locking and uniqueness. Reading DDL does not replace runtime tests.

## Additive implementation migrations

V1 is preserved byte-for-byte. V2 adds Identity `identity_limits` as a singleton row lock to enforce the ten-account quota atomically across duplicate-registration races. Processing `output_attempts` records reserved output paths before work so a crash after upload but before result publication can be cleaned safely with generation preconditions. A published pointer is never orphan cleanup input.

Document V2 adds `upload_sessions.resumable_uri` for cancellation of expired GCS sessions (credential, never logged or returned in metadata) and deletion-confirmation timestamps on upload/version rows. Tombstones remain until physical deletion is confirmed. Folder mutations obtain an exclusive workspace upsert lock and bounded transaction retry for MySQL deadlocks. Expired trash cannot be restored after its14-day retention while purge is processing read grace. These additions are service-owned, introduce no cross-database foreign keys, and leave API fields, event envelopes and native fixtures unchanged; see ADR015.

Processing V3 adds nullable ASCII `jobs.trace_id` for the originating validated 32-hex HTTP/event trace. Jobs persist it before asynchronous execution; completion envelopes recover it after worker restart. Existing rows remain valid without a trace. This technical observation field introduces no cross-database dependency or public API/event field change. Source `backend/schema/processing/V3__trace_correlation.sql` and the service Flyway resource are identical; apply the migration before rolling out the refactored Processing image. See ADR019 and docs/06_ASYNC_PROCESSING.md.

# Collaboration extension (ADR027)

`backend/schema/collaboration/V1__collaboration.sql` is the Collaboration service's independent schema. `collaboration_rooms` records the native head revision, delivery cursor, byte quota and expiring checkpoint reservation. `collaboration_updates` records binary CRDT updates with unique `(document_id, operation_id)` and ordered `(document_id, sequence)`. User identity plus payload equality guard idempotent retries. Room creation and append serialize on one room row. The existing databases and applied migrations are unchanged; access checks use Document's API rather than cross-database SQL.

## payment_db and service-owned entitlements

Payment V1 adds `payment_accounts` (unique user/customer, plan/expiry, generation, work lease and synchronization revision), `payment_requests` (unique user/idempotency key, bounded expiry, status/hosted URL), `payment_sagas` (phase/state, reply bitmask, previous entitlement), `stripe_receipts` (event ID/fingerprint/type/customer only), `saga_inbox` and `saga_outbox`. Requests are private to their JWT subject. Persist customer mappings before subsequent Stripe operations. SQL/Stripe cannot be atomically committed; stable idempotency keys, lease fencing and current-state reconciliation handle uncertainty. No card or full webhook data is stored.

Identity V3, Document V3, Processing V4 and Collaboration V2 independently add `subscription_entitlements`, `saga_inbox` and `saga_outbox`. Projections use per-user monotonic generations and expire paid grants at the stored UTC expiry. Participant mutation/inbox/reply commit together. Payment account activation waits for all four replies; compensation restores prior grants at a higher generation. No cross-database FKs, SQL, or participant business types are shared. Applied older migrations remain unchanged.

Processing migration `V5__office_exports.sql` expands the owned jobs job_type check to EXPORT_DOCX/EXPORT_PDF. It discovers/drops only the original generated check for job_type in the current database and adds the named `ck_jobs_export_type` invariant. Other constraints/tables/service ownership stay unchanged. Resource/schema copies are identical. Run the Processing migration job before rollout; ordinary cloud service startup keeps Flyway disabled.
