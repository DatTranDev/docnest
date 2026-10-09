# Collaboration protocol v1 (local)

Authenticated account editors explicitly choose **Cùng chỉnh sửa** on the same document.
The fourth Spring Boot service owns `collaboration_db`; Document remains the ACL and native-version authority.
Public links never enter a room. JWT issuer/audience/signature are validated, then Document is queried using the caller token on every read, join, append and checkpoint. Revoked users cannot fetch subsequent updates. An HTTP request already authorized can finish concurrently with revocation.

The CRDT is Yjs 13.6.33. UTF-16 text uses Y.Text; bold/italic/underline/font/size/color/alignment are attributes, images reference assets in a Y.Map, and a small settings map preserves empty final paragraph alignment. The native projection assigns the first UTF-16 unit's resolved style/character format to an entire grapheme when concurrent inserts create a combined cluster. Local-origin UndoManager excludes remote edits. Updates are idempotent and commute. The SQL sequence is a delivery cursor, **not** the CRDT clock or the Document head revision.

Routes, all private and no-store:

| Method / path under `/api/v1/collaboration/{documentId}` | Request               | Result                                                                                |
| -------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------- |
| POST `/join?headRevision=N`                              | binary Yjs seed       | room page; SQL accepts only the first seed                                            |
| GET `/updates?after=N`                                   | none                  | `{headRevision,sequence,updates:[{sequence,operationId,payload}]}`; payload is base64 |
| POST `/updates/{operationId}`                            | binary Yjs update     | `{sequence}`; same user/id/bytes retries return the original sequence                 |
| POST `/checkpoint?sequence=N`                            | native `.tedoc` bytes | `{revision}` after Document commits                                                   |

Reads currently return one update at a time to bound memory. Clients catch up to `sequence` before saving and poll every 500ms when caught up. Transport is authenticated HTTP polling, not WebSocket; no tokens in URLs, cookies or logs. Unacknowledged updates are journaled in IndexedDB and replayed with original operation IDs. Kafka is not a keystroke bus.

A checkpoint reserves the exact SQL cursor for up to 120 seconds, releases the SQL transaction, and invokes the ordinary Document upload/commit APIs with optimistic head revision and idempotency key. Appends receive 423 while the reservation is active and retry. The saving user's editor is temporarily locked while synchronizing and serializing; other users can keep editing into their pending queues. External/native writes are never overwritten: a head mismatch returns 409 and preserves the collaboration log for recovery. A process crash after Document commit but before room completion requires recovery; do not silently rebase that room onto the new head. LOCAL uploads go through Document's authenticated content endpoint; GCS_RESUMABLE uploads accept only HTTPS `storage.googleapis.com` capabilities for the configured snapshots bucket, without forwarding JWTs. Real Google Cloud integration is PENDING credentials; URL-policy tests do not prove it.

Bounds: 200,000 UTF-16 units in collaborative UI, 12 MiB per CRDT update, 64 MiB/100,000 updates per room, 32 MiB pending browser journal, 32 MiB native checkpoint. The original 10 MiB/one-million-line standalone editor is unchanged. No automatic compaction, room reset or log deletion is provided yet. Java stores bounded opaque CRDT bytes; clients validate the projected native model. This is not a server-side Yjs semantic validator. An authorized malicious editor can submit a corrupt room update; native saves still pass Document validation. Do not enable untrusted public writes.

Errors: 401 unauthenticated, 403 viewer write, 404 absent/revoked, 409 head/idempotency conflict, 413 quota, 423 checkpoint in progress, 503 Document authorization unavailable. Access failures fail closed. Cloud rollout and multi-instance/load acceptance remain pending until separately validated.

Native V5 extension: independent Y.Text attributes carry link, list, indent, lineSpacing, spaceBefore/After, pageBreak and table (serialized id/columns). Page header/footer/pageNumbers are separate settings map keys, with empty final paragraph metadata retained. The durable update envelope/room revision/checkpoint/ACL protocol is unchanged. Cell text shares canonical Y.Text identities, so independent cells and independent paragraph/page properties merge; same-property simultaneous changes use deterministic Yjs resolution. Headers/footers are bounded single-line plain text. Table cells are one canonical paragraph each; no nested or merged-cell operation is defined. Deploy V5 readers before writers and retain compatible rollback images.
