# Saving files folders and sharing

## Save protocol

1. The editor pins snapshot S containing the text/style/token of localRevision R and the known baseHeadRevision. Each document has one save queue with one in-flight save and the latest pending snapshot.
2. The worker encodes .tedoc, nativeSha256 and byte count while local state may continue changing. Saving indicates an in-flight operation; it does not claim the current text is saved.
3. POST documents/{id}/uploads with expectedHeadRevision, nativeBytes and nativeSha256. The server checks JWT, ACL, quota and limits and issues uploadId with a 15-minute commit deadline. It does not accept an object key from the client.
4. The local adapter uploads through PUT /api/v1/uploads/{uploadId}/content with a bearer token and correct Content-Length. Stream to a create-new file, cap at 32 MiB and finalize atomically. Do not buffer the whole request as a byte array. A local object is created once and has generation string "1"; finalized content is immutable. Each output attempt also uses a new path and generation "1".
5. For GCS, the server starts a resumable session with ifGenerationMatch=0 for the unique path snapshots/{documentId}/{uploadId}.tedoc and supplies the expected total length where supported. The browser PUTs a Blob to the session URI. This URI is a bearer capability: do not log it or cache it in drafts. The application commit deadline does not expire Google's session URI. Cancel and clean expired sessions separately. Completed upload alone is not cloud Saved.
6. POST documents/{id}/versions with an Idempotency-Key UUID and a body containing uploadId and expectedHeadRevision. The server obtains the object's generation, checks actual size/hash, parses ZIP/UTF-8/style/manifest and enforces limits. Do not trust client counts. Invalid native structure returns 422; excessive size returns 413. Validation happens outside SQL and is serialized or leased per ticket.
7. Within a transaction, lock the document and recheck ACL, trash, idempotency and revision. Atomically insert the immutable version, update the head, insert the outbox and response, and mark the ticket COMMITTED. Return 201 with revision/versionId/hash. An unexpired upload cannot commit after its grant is revoked.
8. The client sets baseHeadRevision to the committed revision and savedContentToken to S's token. If the current token differs, keep Unsaved. The next snapshot uses the newly committed base, never a discarded snapshot state.

When a commit outcome is uncertain, retry with the same body and key. The same key/body returns the earlier commit response; the same key with a different body returns 409 IDEMPOTENCY_KEY_REUSED. Look up idempotency after checking current access and before checking TTL/current head so a successful commit retry does not fail because the ticket expired or the head advanced. A key must not switch documents or actors. Retain idempotency records for 24 hours.

Ticket states are CREATED, UPLOADED, VALIDATING, VALIDATED, COMMITTED and ABANDONED. The server may not yet have recorded UPLOADED after a GCS upload; commit inspects the object and performs a valid transition. If validation's lease expires after a process crash, a retry can acquire a new lease and validate the same immutable generation. Do not revalidate COMMITTED tickets. Store hash/generation explicitly on tickets and versions.

## Conflicts

Two snapshots with base=4 may upload concurrently. The first commit creates revision 5. The other returns 409 REVISION_CONFLICT with currentHeadRevision=5; GC will clean its uncommitted object. Keep the snapshot and draft in the UI. Do not retry by changing expectedHeadRevision to 5. Save as new document creates a new document ID and uploads the draft again. Open latest must handle the draft before replacing state.

If the raw native hash equals the head hash, return 200 with the current version and noChange=true without incrementing the revision or emitting an event. Still check the expected head and permissions. A different byte hash may create a version even if semantics are equivalent. Do not deduplicate only text and discard style changes.

## Cloud and local recovery

Cloud autosave uses a 5-second debounce, a minimum 15-second interval and a maximum 60 seconds during continuous edits. Pause on conflict or offline. IndexedDB checkpoints use a 2-second debounce or 50 edits, with a base snapshot and journal deltas; commit the active pointer last. Create a new base checkpoint every 100 edits or 1 MiB of journal. Draft keys include userId/documentId/baseHeadRevision. Never apply one user's draft to another user's session.

After reload, fetch the cloud head and draft metadata. If draft base=head and the draft contains newer content, offer Restore draft. If the base differs from the head, open the draft as a recovered copy with a conflict; never commit automatically. On IndexedDB quota or eviction failures, show recovery unavailable and retain dirty state. Do not rely on beforeunload to save 10 MiB.

## Folder semantics

The root is folder=null. Root children have depth 1; maximum depth is 20. A move checks the deepest descendant after the move. Lock the owner's workspace row for every tree mutation to prevent concurrent A->B/B->A cycles. Sharing a document does not grant access to its folder.

Delete only empty folders; otherwise return 409 FOLDER_NOT_EMPTY. Trashing a document stores restore_folder_id and sets folder_id=NULL so its former folder can be deleted. Restore to the old folder if it still belongs to the owner, otherwise to root. Trash retains grants and links but blocks new reads, commits and sharing. Restoration reactivates grants and links that remain unexpired and unrevoked; explain this in the UI. The owner can revoke them before restoration.

## Account sharing

PUT documents/{id}/permissions/{granteeUserId} creates or updates a grant. The owner's frontend may use POST documents/{id}/permissions with email and role; Document calls Identity's internal resolve endpoint and then performs the same grant operation. The recipient must have an account; otherwise return 422 USER_NOT_REGISTERED without sending email. Do not grant the owner or yourself. Group and folder sharing are outside scope. Owner/grantee emails appear only in the owner's dialog; there is no public user-search endpoint.

DELETE grant is idempotent with 204 and locks the document before revocation. The server never decides access from Redis. Shared with me lists active documents with a grant for the caller, not folders or sibling documents. Unauthorized strangers receive 404 DOCUMENT_NOT_FOUND; a VIEWER attempting a write receives 403 READ_ONLY.

## Public links

The owner creates a link valid for 1 hour to 30 days, default 7 days. Use 32 CSPRNG bytes encoded as unpadded base64url and store SHA256 in lowercase hex. The creation response returns the raw token once to copy /s/{token}. Later lists return only linkId, expiry and status. Keep tokens out of analytics, access logs, trace URLs and error messages. Set Referrer-Policy no-referrer on the public viewer.

Public metadata and content requests check hash, expiry, revocation and trash every time. Stream content through Document Service instead of issuing long-lived public GCS URLs. Use Content-Disposition attachment for native downloads and Cache-Control no-store. A request already in progress or already downloaded data cannot be recalled. Public APIs expose no owner email, folder or ACL and permit neither jobs nor writes. Proposed per-IP rate limits are 20 metadata requests/minute, 10 downloads/minute and 2 concurrent content streams. If Redis fails, use a bounded local limiter.

Authenticated download descriptors issue signed GET URLs valid for at most 60 seconds or local authenticated URLs, bound to the exact generation. After the SQL revocation commit, block new descriptors immediately; issued URLs may remain valid for up to 60 seconds. Job status/download checks the requester and current document access. The access checked at creation is not a permanent permission.

## API errors

Error bodies contain code,message,traceId and optional details. Do not expose SQL paths, bucket secrets, raw share tokens or stack traces. Main codes: REVISION_CONFLICT, IDEMPOTENCY_KEY_REUSED, READ_ONLY, DOCUMENT_NOT_FOUND, FOLDER_NOT_EMPTY, FOLDER_CYCLE, FOLDER_DEPTH_EXCEEDED, INVALID_NATIVE_FILE, FILE_TOO_LARGE, UPLOAD_EXPIRED, QUOTA_EXCEEDED, VERSION_GONE, JOB_TERMINAL and EXPORT_TOO_LARGE. The product's UI messages are Vietnamese; the contracts use stable codes. This English documentation edition does not change the product's localization choice.

## Authentication protocol

Access JWTs use RS256, last 10 minutes and contain sub=userUUID, configured iss, aud=editor-api, iat/exp/jti. Every resource server validates issuer, audience, algorithm and time. Refresh cached JWKS for a new kid. Register creates only the user; the UI calls login afterward. MVP emails are ASCII and normalized to lowercase. Passwords contain 12–128 code points and are not trimmed. Obtain a CSRF token before register/login/refresh/logout. The refresh_token cookie uses HttpOnly, Secure and SameSite=Lax over HTTPS with path /api/v1/auth. A localhost HTTP development profile may use Secure=false; never deploy that profile. Use one frontend origin, an Origin allowlist and a required CSRF header. Refresh is singleflight to prevent concurrent reuse of an old token. Refresh families expire absolutely 14 days from login; rotation does not extend them indefinitely. Logout revokes the refresh family; an issued access JWT may remain valid for up to 10 minutes. Do not claim immediate invalidation of every JWT.

For POST jobs and result status/download, Processing forwards the caller's access JWT to Document. Job creation obtains a descriptor for a specific version. Status/download needs only GET current document metadata to check the ACL; the input version need not remain in published history. Always read source objects through server-stored references and generations, never a browser-supplied objectRef.
