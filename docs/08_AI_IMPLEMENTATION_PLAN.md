# AI implementation plan from start to finish

Each step is one commit or a small pull request. Start a dependent step only after its preceding gate has actually run. Independent work may continue while a cloud gate is PENDING, but record dependencies and do not mark deployment complete. P00 and P01 create repository build/test commands; this documentation kit has no application on which to run them yet.

## Opening prompt

```text
You are the implementation engineer for this repository. Read README.md, AI_AGENT_GUIDE.md and the specified contracts. Implement P00 in docs/08_AI_IMPLEMENTATION_PLAN.md. Inspect the repository before editing and use the agreed ADRs for routine decisions. After editing, run the actual gate and report changed files, commands, results and remaining limitations. Stop after P00 for review. Create code and configuration; deploy to the cloud only when specifically requested.
```

## Sequence and gates

### P00 Initialize the repository and lock contracts

Inputs: README.md; AI_AGENT_GUIDE.md; docs/01_PRODUCT.md; docs/02_ARCHITECTURE.md; contracts.

Scope: Create a monorepo, a Maven reactor for three services, apps/web and packages/editor-core. Add Maven Wrapper, lockfile, lint, formatting, local/cloud configuration and versions.lock.md. Verify compatibility of Java 21, Spring Boot 4.1.1 and dependencies; pin Kafka, MySQL and Redis image digests. Bring contracts, schema and fixtures into the repository.

Gate: All three services build; the frontend passes typecheck; contracts parse. README contains working build/test commands. Images do not use latest tags, and the repository contains no real secrets.

```text
Implement P00. Read the inputs, scope and gate in this section. Check dependency status in reports/progress.md; P00 initializes the report if absent. Follow contracts and ADRs and add meaningful tests for invariants or failures. Run real builds/tests and update the report with commands and results. If contracts change, update related documents and schemas together. Stop when the gate is complete or report a concrete blocker. Do not lower requirements or skip tests to record PASS.
```

### P01 Local infrastructure and migrations

Inputs: P00; schema; docs/03_DATA_MODEL.md; docs/07_GOOGLE_CLOUD_RUNBOOK.md.

Scope: Create Docker Compose with MySQL, three databases and three database users, Kafka KRaft, Redis, volumes and health checks. Configure Flyway per service. Add .env.example and scripts/dev-up, dev-down and smoke; use placeholders for secrets.

Gate: A database user cannot read another service's database. Rerunning Flyway does not reapply V1. Container restarts preserve SQL/Kafka data. Internal ports are available only within the Compose network or bound to localhost for debugging.

```text
Implement P01. Read the inputs, scope and gate in this section. Check dependency status in reports/progress.md; P00 initializes the report if absent. Follow contracts and ADRs and add meaningful tests for invariants or failures. Run real builds/tests and update the report with commands and results. If contracts change, update related documents and schemas together. Stop when the gate is complete or report a concrete blocker. Do not lower requirements or skip tests to record PASS.
```

### P02 Identity and JWT

Inputs: P01; Identity section of contracts/openapi.yaml; schema/identity.

Scope: Implement registration, login, me, CSRF, refresh, logout and JWKS. Use Argon2id and RS256 JWTs with issuer/audience validation; rotate refresh tokens within a transaction. Access tokens last 10 minutes, and refresh families have an absolute 14-day expiry. Only Document may call the internal user-resolution endpoint.

Gate: JUnit and integration tests cover wrong passwords, concurrent duplicate-email registration, CSRF, expired JWTs, wrong algorithm/audience, refresh reuse and logout. Logs contain no passwords, tokens or private keys.

```text
Implement P02. Read the inputs, scope and gate in this section. Check dependency status in reports/progress.md; P00 initializes the report if absent. Follow contracts and ADRs and add meaningful tests for invariants or failures. Run real builds/tests and update the report with commands and results. If contracts change, update related documents and schemas together. Stop when the gate is complete or report a concrete blocker. Do not lower requirements or skip tests to record PASS.
```

### P03 Document metadata and folders

Inputs: P02; docs/01_PRODUCT.md; docs/03_DATA_MODEL.md; folder/document APIs.

Scope: Implement folder creation, listing, renaming, moving and empty deletion. Use the workspace row lock for cycles, depth and quotas. Implement document creation, listing, metadata reads, renaming, moving, trash and restoration. Head revision 0 is an empty file with no version. metadataRevision is independent of headRevision. Use keyset pagination.

Gate: Two accounts cannot read each other's folders. Concurrent moves cannot create cycles. Reject depth 21 and duplicate sibling folder names. Nonempty folders cannot be deleted. Restore to root if the former folder no longer exists.

```text
Implement P03. Read the inputs, scope and gate in this section. Check dependency status in reports/progress.md; P00 initializes the report if absent. Follow contracts and ADRs and add meaningful tests for invariants or failures. Run real builds/tests and update the report with commands and results. If contracts change, update related documents and schemas together. Stop when the gate is complete or report a concrete blocker. Do not lower requirements or skip tests to record PASS.
```

### P04 Small editor and codec

Inputs: P00; docs/04_EDITOR_ENGINE.md; native manifest schema; fixtures.

Scope: Implement TextAdapter, persistent StyleTree with uniform/run leaves, transactions, history and contentToken. Create an editor harness with B/I/U and Unicode IME support. Implement the native codec, TXT import/export and Java native validator. The decoder must already read dense fixtures; P11 adds dense leaves to the editing model.

Gate: Property tests use a small oracle. Java and TypeScript read uniform/run/dense golden files correctly. Undo restores styles. Test surrogates, combining marks, empty files and corruption. Do not enable CodeMirror history alongside HistoryManager.

```text
Implement P04. Read the inputs, scope and gate in this section. Check dependency status in reports/progress.md; P00 initializes the report if absent. Follow contracts and ADRs and add meaningful tests for invariants or failures. Run real builds/tests and update the report with commands and results. If contracts change, update related documents and schemas together. Stop when the gate is complete or report a concrete blocker. Do not lower requirements or skip tests to record PASS.
```

### P05 End to end saving through local storage

Inputs: P03, P04; docs/05_SAVE_AND_SHARE.md; upload/commit APIs.

Scope: Implement a streaming local StorageProvider, upload tickets, hash/generation checks and native validation. Commit version, head, outbox, idempotency response and ticket state in one transaction. The frontend uses one save queue, snapshot-token dirty state and basic conflict UI.

Gate: Edit, save and reload preserve text/style. Competing commits with one base yield one success and one 409. Retrying after a lost acknowledgement does not create another version. Invalid native files do not change the head. Editing R+1 while saving R remains Unsaved.

```text
Implement P05. Read the inputs, scope and gate in this section. Check dependency status in reports/progress.md; P00 initializes the report if absent. Follow contracts and ADRs and add meaningful tests for invariants or failures. Run real builds/tests and update the report with commands and results. If contracts change, update related documents and schemas together. Stop when the gate is complete or report a concrete blocker. Do not lower requirements or skip tests to record PASS.
```

### P06 Sharing permissions and public links

Inputs: P02, P05; permissions/share-link APIs; permission matrix.

Scope: Implement account grants/revocation, Shared with me and read-only public links. Public tokens use 256 bits, hash-only storage, expiry and revocation. Stream public content through Document. Use SQL ACL checks for all reads/saves/exports; only owners perform original-document metadata operations.

Gate: Viewers cannot write. Editors cannot rename, delete or share the original. Revocation between upload and commit blocks commit. Invalid, expired and revoked links all return 404. Public data exposes no folder/email. Signed GET URLs last at most 60 seconds, and logs redact tokens.

```text
Implement P06. Read the inputs, scope and gate in this section. Check dependency status in reports/progress.md; P00 initializes the report if absent. Follow contracts and ADRs and add meaningful tests for invariants or failures. Run real builds/tests and update the report with commands and results. If contracts change, update related documents and schemas together. Stop when the gate is complete or report a concrete blocker. Do not lower requirements or skip tests to record PASS.
```

### P07 Workspace and frontend flows

Inputs: P03, P05, P06; docs/01_PRODUCT.md.

Scope: Build login/register, breadcrumbs, paginated lists, document creation/moving/trash, toolbar, save statuses, Shared with me, share dialog, public viewer, version history and Save as new document. Integrate CSRF and singleflight refresh; keep access JWTs in memory.

Gate: Playwright with two accounts verifies F01 through F09 and F12. Browser reload recovers a valid session. UI and API permissions agree. End-to-end tests use real backends.

```text
Implement P07. Read the inputs, scope and gate in this section. Check dependency status in reports/progress.md; P00 initializes the report if absent. Follow contracts and ADRs and add meaningful tests for invariants or failures. Run real builds/tests and update the report with commands and results. If contracts change, update related documents and schemas together. Stop when the gate is complete or report a concrete blocker. Do not lower requirements or skip tests to record PASS.
```

### P08 Worker search and recovery

Inputs: P04, P07; docs/04_EDITOR_ENGINE.md; docs/05_SAVE_AND_SHARE.md.

Scope: Implement the worker replica with ACK, resync and cancellation, plus streaming search/replace. Add IndexedDB snapshots/journals, throttled autosave, offline recovery and changed-cloud-head handling. Create search highlights only within the viewport.

Gate: Matches across chunk boundaries are correct; stale results are discarded. Undo sends deltas with the correct revision. Test crash recovery, IndexedDB quotas and cloud-head conflicts. Never stringify the full document during a keystroke or render.

```text
Implement P08. Read the inputs, scope and gate in this section. Check dependency status in reports/progress.md; P00 initializes the report if absent. Follow contracts and ADRs and add meaningful tests for invariants or failures. Run real builds/tests and update the report with commands and results. If contracts change, update related documents and schemas together. Stop when the gate is complete or report a concrete blocker. Do not lower requirements or skip tests to record PASS.
```

### P09 Kafka outbox and inbox

Inputs: P05, P01; docs/06_ASYNC_PROCESSING.md; event schemas.

Scope: Implement the outbox relay with leases, broker ACKs and retries. Validate event JSON before publishing. Consumers commit inbox records with their mutations before ACK. Create lab topics with 3 partitions and replication factor 1, a DLQ, and a replay command with dry-run support. Document projections guard revision before updating.

Gate: Saving works with Kafka down. A crash after publication causes duplicates without repeated mutations. Reordering cannot apply an old preview to a new head. Invalid-schema events are redacted into the DLQ; valid replays retain eventId. Payloads contain only object references and capped previews, never full files or tokens.

```text
Implement P09. Read the inputs, scope and gate in this section. Check dependency status in reports/progress.md; P00 initializes the report if absent. Follow contracts and ADRs and add meaningful tests for invariants or failures. Run real builds/tests and update the report with commands and results. If contracts change, update related documents and schemas together. Stop when the gate is complete or report a concrete blocker. Do not lower requirements or skip tests to record PASS.
```

### P10 Processing and export jobs

Inputs: P06, P09; schema/processing; jobs APIs.

Scope: Implement job creation with permission checks, quotas, idempotency and outbox, then dispatch QUEUED to READY. Add the preview consumer, worker leases/heartbeats/reclaim, streaming TXT/HTML exports, output caps and TTL. Cancel/status/download check current permissions.

Gate: A worker that loses its lease cannot publish output. I/O retries are bounded; deadlines and cancellation races behave correctly. HTML escaping prevents XSS, and oversized output returns an error. Revocation blocks new downloads. A crash after inbox commit does not lose the job.

```text
Implement P10. Read the inputs, scope and gate in this section. Check dependency status in reports/progress.md; P00 initializes the report if absent. Follow contracts and ADRs and add meaningful tests for invariants or failures. Run real builds/tests and update the report with commands and results. If contracts change, update related documents and schemas together. Stop when the gate is complete or report a concrete blocker. Do not lower requirements or skip tests to record PASS.
```

### P11 Dense StyleTree and large benchmarks

Inputs: P08, P10; docs/09_TEST_AND_BENCHMARK.md.

Scope: Add dense leaves, adaptive encoding, lazy style transforms, byte accounting and cache/history limits. Generate million-line, very-long-line, Unicode and dense-style workloads. Profile hot paths and optimize from measured data.

Gate: Golden/property tests still pass with dense leaves. Report p50/p95/p99, RAM, DOM and each workload separately. Every missed target needs an ADR and an explicit UX limitation. Never fabricate results.

```text
Implement P11. Read the inputs, scope and gate in this section. Check dependency status in reports/progress.md; P00 initializes the report if absent. Follow contracts and ADRs and add meaningful tests for invariants or failures. Run real builds/tests and update the report with commands and results. If contracts change, update related documents and schemas together. Stop when the gate is complete or report a concrete blocker. Do not lower requirements or skip tests to record PASS.
```

### P12 Google Cloud Storage adapter

Inputs: P05, P10; GCS documentation; StorageProvider interface.

Scope: Implement create-only resumable sessions, pinned generations, signed GET URLs lasting at most 60 seconds or authenticated proxy streaming. Prepare bucket CORS/IAM, actual hash/native validation and reference-aware GC. Integrate with a lab bucket when deployment is requested and suitable credentials are available.

Gate: Committed objects cannot be overwritten. Distinguish commit TTL from session URI lifetime. Recheck revocation; orphan GC never deletes the head. Adapter contract tests exist. If real GCS integration has not run, mark the cloud gate PENDING and continue independent local work.

```text
Implement P12. Read the inputs, scope and gate in this section. Check dependency status in reports/progress.md; P00 initializes the report if absent. Follow contracts and ADRs and add meaningful tests for invariants or failures. Run real builds/tests and update the report with commands and results. If contracts change, update related documents and schemas together. Stop when the gate is complete or report a concrete blocker. Do not lower requirements or skip tests to record PASS.
```

### P13 Docker images and CI CD

Inputs: P02 through P12; docs/07_GOOGLE_CLOUD_RUNBOOK.md.

Scope: Create multi-stage images with non-root JVM processes, web/proxy and full-application Compose. CI runs tests/builds, configures OIDC to Artifact Registry and deploys by digest. Migrations run in a separate job; secrets are referenced from configuration outside the image/repository.

Gate: A fresh checkout starts locally with one documented README command. End-to-end smoke uses real services. Dependency/secret scans pass; images contain no private keys. Image rollback is documented. Local gates may complete while P12 GCS integration remains PENDING.

```text
Implement P13. Read the inputs, scope and gate in this section. Check dependency status in reports/progress.md; P00 initializes the report if absent. Follow contracts and ADRs and add meaningful tests for invariants or failures. Run real builds/tests and update the report with commands and results. If contracts change, update related documents and schemas together. Stop when the gate is complete or report a concrete blocker. Do not lower requirements or skip tests to record PASS.
```

### P14 Deploy the lab VM and measure costs

Inputs: P13; runbook; cloud deployment request from the owner.

Scope: Prepare gcloud/Terraform for VM, buckets, firewall, IAM and budgets. Present a calculator estimate, resource inventory and rollback before provisioning. After a deployment request, run one VM with HTTPS, backup/restore and complete smoke flows. Keep a deployment report.

Gate: Saving/sharing/export/restart pass. Buckets are private and internal ports closed. A DB restore has been exercised. The estimate fits the reserved VM budget. Without a deployment request, deliver reviewable configuration and mark the gate DEPLOY_PENDING.

```text
Implement P14. Read the inputs, scope and gate in this section. Check dependency status in reports/progress.md; P00 initializes the report if absent. Follow contracts and ADRs and add meaningful tests for invariants or failures. Run real builds/tests and update the report with commands and results. If contracts change, update related documents and schemas together. Stop when the gate is complete or report a concrete blocker. Do not lower requirements or skip tests to record PASS.
```

### P15 GKE lab and cleanup

Inputs: P14; runbook; cloud deployment request from the owner.

Scope: Create Kustomize base/lab overlays, Deployments, Services, StatefulSets, PVCs, probes and resource limits. Add Workload Identity, migration job and optional ingress. Validate/dry-run before deploying one-node zonal GKE. Try two Processing replicas and then clean up from the inventory.

Gate: Keep evidence for rolling updates, partition assignment, worker kill/reclaim and PVC restart. Check smoke results and billing. Cleanup leaves no forgotten paid resources. Describe one node as a lab without HA. If not deployed, mark the gate DEPLOY_PENDING.

```text
Implement P15. Read the inputs, scope and gate in this section. Check dependency status in reports/progress.md; P00 initializes the report if absent. Follow contracts and ADRs and add meaningful tests for invariants or failures. Run real builds/tests and update the report with commands and results. If contracts change, update related documents and schemas together. Stop when the gate is complete or report a concrete blocker. Do not lower requirements or skip tests to record PASS.
```

### P16 Optional gRPC exercise

Inputs: MVP gates A through E; contracts/snapshot.proto.

Scope: Replace one internal snapshot-authorization REST call between Processing and Document with gRPC. Forward the actor access JWT through redacted metadata/payload; validate service identity and the actor's ACL. Add deadlines, retries and cancellation while preserving the public API.

Gate: Interop contracts pass; invalid actors/callers are rejected. Timeouts/backoff cannot create duplicate jobs. Measure actual latency. Real-time collaboration requires ADR013 and a separate plan.

```text
Implement P16. Read the inputs, scope and gate in this section. Check dependency status in reports/progress.md; P00 initializes the report if absent. Follow contracts and ADRs and add meaningful tests for invariants or failures. Run real builds/tests and update the report with commands and results. If contracts change, update related documents and schemas together. Stop when the gate is complete or report a concrete blocker. Do not lower requirements or skip tests to record PASS.
```

## Report after each step

reports/progress.md records step ID, commit SHA, scope, changed files, executed commands, results, contract changes, benchmarks where applicable, blockers and next step. Mark DONE only after executing the gate. Use PENDING for cloud integration, DEPLOY_PENDING for undeployed infrastructure and NOT_RUN for unexecuted checks, with a reason. Crash/race tests must describe the injected failure and observed evidence.

## Delivery milestones

P00 through P07 produce usable edit/save/folder/share flows for small files. P08 through P11 complete recovery, events, jobs and large-file acceptance. P12 through P15 prepare and deploy the cloud environment. P16 is an optional gRPC exercise. Real-time editing is separated into ADR013 after the MVP.
