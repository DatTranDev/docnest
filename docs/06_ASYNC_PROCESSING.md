# Event processing outbox and Redis

Committed SQL records and files are the authoritative data. Kafka separates slow work from save requests. Use at-least-once delivery and deduplication; do not promise end-to-end exactly-once behavior across SQL, Kafka and GCS.

## Topics and consumers

| Topic                       | Producer               | Consumer                       | Key          |
| --------------------------- | ---------------------- | ------------------------------ | ------------ |
| document.version.saved.v1   | Document outbox        | processing-preview-v1          | documentId   |
| processing.job.requested.v1 | Processing outbox      | processing-dispatch-v1         | documentId   |
| processing.job.completed.v1 | Processing outbox      | document-preview-projection-v1 | documentId   |
| editor.dead-letter.v1       | Consumer error handler | Manual replay tool             | Original key |

Each business topic has 3 partitions, replication factor 1 in the lab, 24-hour retention and a 64 KiB message cap. The dead-letter queue (DLQ) has 7-day retention and a 128 KiB cap. JSON schemas in docs/contracts/events define fields and types. An event contains eventId,eventType,schemaVersion,occurredAt,producer,traceId,payload. Do not include full text/native bytes, JWTs or share tokens. PREVIEW completion may contain sampleText of at most 2000 Unicode code points as defined by the schema. Topics and the DLQ therefore contain private data and must be readable only by relevant services.

Kafka preserves append order within a partition. Concurrent producers, retry topics and parallel workers can still deliver older revision results later. Document updates its preview projection only when payload.revision=headRevision and state=SUCCEEDED. Never move the projection backward. A documentId key does not replace this guard.

## PREVIEW semantics

wordCount counts sequences of code points that are not Unicode White_Space, separated by one or more White_Space characters. This is a whitespace-token count, not natural-language word segmentation. Pin the same Unicode rules in the validator and worker. sampleText takes at most the first 2000 code points and retreats to a valid grapheme boundary; render it as a text node. Successful PREVIEW has a populated summary and outputRef=null. Successful exports have a populated outputRef and summary=null. FAILED/CANCELLED has outputRef=null, summary=null and an appropriate errorCode. Document publishes a summary only for the current head revision and only to a caller with read access.

## Outbox relay

Insert the outbox row in the business transaction with a complete JSON envelope and stable eventId. Poll every second in batches of at most 100. The lab uses one relay thread per service. Claim with a lease/CAS, publish with acks=all and an idempotent producer, then mark published_at after broker ACK. A crash after publication but before marking causes duplicates; the inbox handles them. On publish failure, retain the row and back off 1/5/30/60 seconds. Never delete before ACK. Keep published rows for 7 days for debugging; never age-purge unsent rows.

The lab relay publishes in auto-increment outbox ID order. Multiple relay instances need per-aggregate serialization or consumers that tolerate reordering. Do not assume SKIP LOCKED guarantees aggregate order. Save commit does not wait for the broker. Expose outbox_pending and oldest_pending_seconds. The UI shows Processing delayed while a projection is pending.

## Inbox and job dispatch

The DocumentVersionSaved consumer transaction inserts an inbox receipt with unique(consumer,eventId), creates a PREVIEW job with unique(documentId,revision,type) if absent, and sets it READY. Obtain the job reference from the validated event without cross-database calls. Commit before acknowledging Kafka.

For user POST jobs, authorize the revision through Document using the user token, touch last_access_at and check quota under a requester_queues lock. Insert a QUEUED job, JobRequested outbox event and idempotency record. The JobRequested consumer inserts the inbox record and CAS-transitions QUEUED->READY in one transaction; commit before ACK. SQL is the durable job queue. Kafka provides durable wakeup/dispatch between API and worker. Long queue delays indicate a slow outbox or consumer.

The scheduler claims READY jobs with next_attempt_at<=now or RUNNING jobs with expired leases. Use FOR UPDATE SKIP LOCKED, set RUNNING, increment attempts and set lease_owner/lease_until. Run work outside the transaction and heartbeat every 15 seconds. Each process has concurrency 2; the per-user queued-job limit is 5. Use a new output path results/{jobId}/{attemptId}.{ext} and bind its generation. Completion updates only if lease_owner still matches, then publishes JobCompleted through the outbox. A stale worker must not overwrite the result pointer.

Transient storage/network failures allow at most 3 attempts, scheduling retries after 5 and 30 seconds. Enforce a 15-minute deadline and 120 seconds per attempt. Exhausted retries or deadline produce FAILED. Invalid codec, quota failures and output exceeding 64 MiB are permanent errors. Cancel QUEUED/READY jobs into CANCELLED. For RUNNING, set cancel_requested and check it between chunks. If completion wins the race, return 409 JOB_TERMINAL. JobCompleted is a terminal event with payload.state SUCCEEDED/FAILED/CANCELLED.

If output uploads but SQL commit fails, retry with a new attempt object. After 24 hours, GC deletes objects not referenced by a job result. Do not rely solely on Redis locking to ensure only one worker publishes a result.

## Kafka retries and dead letters

Schema errors go immediately to the DLQ with originalTopic,partition,offset,originalKey,originalPayloadBase64,reason. Retry delivery for temporary database failures 3 times at 1/5/30 seconds; if still failing, send to DLQ and alert. Original payloads are capped at 64 KiB, DLQ messages at 128 KiB. Restrict DLQ reads to operators/services and never log payloads. Valid events forbid credentials, but invalid payloads may contain secrets. Do not copy unvalidated bytes into the DLQ: set originalPayloadBase64 to an empty string, originalKey=null and reason=INVALID_SCHEMA_REDACTED; record hash/offset in operator logs. Retain bytes for replay only for validated payloads that fail due to the database.

A DLQ entry is not job success. QUEUED jobs or missing previews still require replay after repair. Redacted payloads cannot be automatically replayed from the DLQ; fix the producer and issue a new valid event. Replaying a valid payload creates a wrapper operation log and republishes the original business eventId so deduplication remains effective. Manually supplied new payloads require a new eventId and validation.

Application retries in jobs differ from consumer delivery retries. Do not retry work in SQL while indefinitely republishing JobRequested. Kafka's 24-hour retention is not version history; history lives in SQL/GCS.

## Redis

| Key                                     | TTL | Content                                                       |
| --------------------------------------- | --- | ------------------------------------------------------------- |
| rate:login:{hashedIp}                   | 60s | Atomic Lua counter, at most 10 attempts/IP/minute             |
| rate:public:{hashedIp}                  | 60s | Metadata/download counters; no raw tokens                     |
| docmeta:{documentId}:{metadataRevision} | 60s | Metadata without ACL, URLs or content                         |
| jobstatus:{jobId}                       | 5s  | Status projection; verify SQL/requester/ACL before responding |

Caching is optional and follows correctness. Do not cache authorization or store raw refresh tokens. Revision-based metadata keys prevent stale overwrites; read sharing, titles and lists from SQL when needed. Redis receives no per-keystroke updates and holds no undo stack. Redis Pub/Sub is reserved for best-effort presence/notifications in a later collaboration phase; it is not the MVP's durable event transport.

## Observability

JSON logs contain service,requestId,traceId,documentId,jobId,eventId,revision and elapsedMs, but no text, email, password, token or session URI. Metrics include save_conflict, validation_fail, outbox_age, consumer_lag, DLQ_count, job_queue_age, lease_reclaim, job_duration, Redis fallback, heap and snapshot_bytes. Trace HTTP -> outbox -> consumer through traceId in the envelope. Health endpoints distinguish liveness from readiness.

The shared `common.observability` code accepts a valid W3C `traceparent` or a lowercase, nonzero 32-hex `X-Trace-Id`; otherwise it generates a new trace. HTTP responses return `X-Trace-Id` and `X-Request-Id`. API errors use that request trace, and validated event consumers restore the envelope trace in a bounded scope. Processing migration `V3__trace_correlation.sql` adds nullable `jobs.trace_id`, so workers and completion events preserve correlation after a restart. Existing rows with no trace receive a new trace when observed. No public API or event fields change.

Spring's Logstash console encoder emits structured JSON. Owned request/event logs allow only fixed actions, UUID identifiers, trace identifiers, revision, elapsed time and status. Invalid events log a SHA-256 fingerprint and broker partition/offset, never original keys or bytes. Metric names include `editor.http.duration`, `editor.save.conflict`, `editor.validation.fail`, `editor.outbox.oldest.pending.seconds`, `editor.jobs.queue.age.seconds`, `editor.dlq.count`, `editor.lease.reclaim`, `editor.job.duration`, `editor.redis.fallback`, and `editor.snapshot.bytes`. Kafka client binders expose consumer fetch-manager records-lag meters; Actuator supplies JVM heap meters. Metrics remain on private service endpoints and are not routed through the public gateway.
