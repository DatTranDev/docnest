# Selective CI/CD and routine GKE releases

This runbook implements the owner's 16 October 2026 CI/CD proposal. It describes operator actions; local build/test commands do not execute them. Current execution evidence and pending cloud acceptance are recorded only in [PROJECT_STATUS.md](PROJECT_STATUS.md).

## Release paths

| Workflow                                   | Use                                                                                                            | Backup behavior                                                                                                                   |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Routine selective GKE release**          | Compatible code/config/manifest releases on `main`                                                             | Verifies a reviewed encrypted recovery object, its generation, nonempty size and age (maximum 24 hours); never pauses Deployments |
| **Maintenance full build & deploy GKE**    | Bootstrap adoption, coordinated native/event/protocol changes, incompatible migrations or explicit maintenance | Preserves the existing quiesced, application-consistent encrypted backup path; all applications pause                             |
| **Build cloud images (manual, no deploy)** | Publish a full scanned release without deployment                                                              | No application or infrastructure mutation                                                                                         |
| **Scheduled full acceptance**              | Weekly comprehensive local-service/browser validation; also manual                                             | No cloud credentials or deployment                                                                                                |

The advanced reviewed-digest workflow remains available. Full and selective mutations share `cloud-gke-deployment` with cancellation disabled. Do not operate manually against the same environment during either workflow. GitHub concurrency serializes mutations; it is not a durable FIFO release queue, so review superseded pending runs.

## Impact and build policy

`tooling/scripts/detect_affected.py` uses PR merge-base, push predecessor, or an approved deployed commit. Checkout includes full history. Git diffs disable rename detection, accounting for both old and new paths and deletions. Missing initial history selects all applications; an invalid explicitly supplied base fails. The routine path also requires that the baseline commit is an ancestor of the requested `main` commit.

- A Document source change selects only Document. New Document migrations select Document and its migration Job. Existing migration modifications/deletions are rejected.
- Shared common/Maven inputs conservatively select all backends. Shared codec/native/event contracts require a coordinated full release, including Web. Frontend/package changes select Web.
- An application Deployment manifest selects that application without requiring a new image. Shared infrastructure/tooling/security/test inputs conservatively trigger broad validation and image rebuilding; routine apply still excludes infrastructure/bootstrap resources.
- Documentation-only changes run global quality, contracts, secret and release-policy checks; frontend/backend tests and production builds can be omitted when their inputs are unaffected. `application` remains the stable required status and rejects failed detection or unexpected skips/cancellations.
- An optional protected manual service list can **add** targets, never remove detected ones. Secret scans, provenance checks and contract checks are not bypassed by narrowing a service folder.

Backend artifacts for the selected modules and their dependencies are packaged in one Maven reactor, then copied into separate runtime images. Full releases reuse that reactor across five image targets. Web is built only when selected. BuildKit caches persist between successful runs; runtime package-install layers refresh before scanning. Secret and Trivy gates cover exactly the selected local image IDs. Publication checks the tagged image ID against both scanner records before pushing. Unaffected application images are not published again.

Cloud publication retains the broad runtime validation gate. Its Docker integration fixtures may build all six local application images to exercise cross-service behavior; these are separate from the selected, scanned registry release images. A fully selective integration fixture strategy must retain equivalent real-service coverage before changing that policy.

## Build manifests and approved environment state

`cloud-release.json` uses `schemaVersion: 2`. A build manifest contains only its newly built images. Each image has its own source commit, repository Actions run URL, exact local image ID, scan-report SHA-256, and successful secret/High-Critical gates. This is same-run workflow provenance, not a cryptographically signed SLSA attestation.

A successful deployment exports `deployment-evidence/environment-state.json`: all six immutable images plus their individual provenance. The routine workflow merges new records into this approved state, preserving unaffected digest/provenance pairs. It verifies all six images against the actual healthy, stable cluster before any mutation. Registry project/region/repository/service names are allowlisted. Google client and native-format compatibility remain enforced.

The initial baseline must come from a successful full deployment using V2 provenance. Review the artifact from the trusted repository and successful protected deployment run, then pass its exact environment-state JSON to `approved_state`. Subsequent routine releases use the prior successful routine artifact. Do not use a raw build artifact or a failed rollout's state: only `rolloutStatus: PASS` is accepted. `PENDING` means inspection/reconciliation is required. The artifact is operator-reviewed desired state, not a mutable image tag or an unverified registry lookup.

## One-time operator prerequisites

Do these only in the authorized cloud session after reviewing cost and access. They are not run by local validation:

1. Apply the reviewed update to `infra/k8s/deploy-rbac.example.yaml` with the real project. It adds read-only Pods, EndpointSlices and release-scoped migration Job observation. Deploy still cannot read Secrets or exec into Pods. The backup identity remains separate.
2. Review one additional Pod's CPU/memory and the temporarily draining old Pod against actual cluster headroom. Keep one desired replica in this lab; `maxSurge: 1`, `maxUnavailable: 0`, readiness probes and 10 seconds minimum readiness preserve serving Pods when capacity permits. Do not increase permanent replicas or cloud resources without a separate budget decision.
3. Apply the reviewed optional BackendConfig connection-draining change through the infrastructure operator. Routine deployment does not apply Ingress/BackendConfig/IAM. Application grace is 160 seconds, with 10 seconds preStop drain and up to 135 seconds graceful shutdown; the gateway's bounded request deadline remains 130 seconds. Validate actual GKE NEG/load-balancer draining, not only YAML.
4. Run an isolated restore drill and real-service mixed-Pod rollout acceptance. Capture unchanged-image and Document-only deployments with continuous authenticated traffic, long downloads/uploads, outbox lease expiry/retry, Kafka rebalances and processing recovery, saga replay, and collaboration polling/reconnection/checkpoints. Record endpoint availability and unchanged unrelated Pod UIDs. Use the existing real MySQL/Kafka/Redis suites, smoke, billing-saga, Worker and collaboration/browser checks; mocks do not satisfy this prerequisite.
5. Only after reviewing that evidence, configure protected `cloud-gke` Variables `ROUTINE_RELEASE_ENABLED=true`, `ROLLOUT_ACCEPTANCE_RUN` and `RESTORE_DRILL_RUN` as repository Actions run URLs. These are operator acceptance gates, not proof inferred from static tests. Leave the feature disabled until the evidence exists.
6. Establish a reviewed recovery point no older than 24 hours in the configured backup bucket. Routine validates remote object metadata without accessing plaintext. Review its consistency/restore scope separately; a recent upload alone does not prove recoverability.

Open **Routine selective GKE release**, choose `main`, supply the approved state and encrypted backup reference. Leave extra services empty for automatic impact. For changed migration files, select the compatibility checkbox only after reviewing mixed-version safety. No cloud provisioning or extra replicas are created by this workflow.

## Targeted apply and migration rules

The renderer emits only selected Deployments and applicable migration Jobs. It renders public config once, computes per-service effective-config hashes and uses explicit ConfigMap key references. A config change affecting an unselected consumer fails before apply; widen the selection. Runtime Web proxy trust is validated with the actual gateway configuration parser. Server dry-run must pass for all selected resources before any mutation.

Migration Jobs use release-specific names, are created without deleting another run's Jobs, and run only for owners with changed migration files. The environment lock and active-Job check prevent overlap with known application migration Jobs. Kubernetes RBAC cannot constrain Job create by name; protected workflow review remains necessary. Jobs still use the owning service image, migration-only mode and disabled Flyway in ordinary startup.

Use expand → backfill → contract. An additive migration may still hold a long MySQL metadata lock: review its algorithm/lock behavior, table size and old-reader compatibility. Breaking changes require maintenance or a separately reviewed staged migration. Never edit an applied migration or assume image rollback reverses SQL. A migration-file diff cannot detect manual schema drift; retain Flyway history monitoring and operator reconciliation.

Only selected backend Deployments apply, sequentially, before selected Web. Existing desired replica counts are preserved; nothing is scaled to zero. EndpointSlice readiness and public HTTPS readiness are sampled throughout mutation. Rollout stops advancing after a detected observation failure. This is a sampled readiness guard, not authenticated traffic, latency/error-budget acceptance or a canary controller.

Artifacts contain previous/new immutable state, per-stage durations/results, readiness samples, and bounded Deployment/template fingerprints/Pod UIDs. Arbitrary Pod environments, document contents, migration output, credentials and tokens are not retained. Unselected Deployment identity/template and Pod UIDs must remain unchanged.

## Worker and connection audit before replica expansion

Source review finds durable concurrency controls; it does not replace real overlapping-replica/failure testing:

| Workload           | Existing control                                                                                | Required runtime gate                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Document outbox    | `JdbcOutboxDao` row lock, 30-second lease, owner-fenced acknowledgement/retry; per-handler UUID | Delayed publish/lease expiry, duplicate delivery and idempotent consumer behavior |
| Document retention | Locked retired-version checks, durable cleanup tombstones and generation-pinned object deletion | Overlapping collectors, retry after partial delete and concurrent save/read       |
| Processing         | `FOR UPDATE SKIP LOCKED`, lease renewal and fenced completion; durable output attempts          | Kafka rebalance, killed worker, expired lease and output ownership                |
| Billing            | Transactional inbox/outbox and subscription generation fencing                                  | Duplicate/reordered messages and mixed-version compensation                       |
| Collaboration      | SQL room lock, operation-id/payload checks and checkpoint lease                                 | Two Pods, duplicate operations, polling reconnect and checkpoint crash            |
| Web                | Streaming HTTP, private Next child and bounded graceful drain                                   | Real ingress keep-alive, slow requests and SIGTERM                                |

Collaboration currently uses authenticated HTTP polling, not WebSockets. The gateway's upgrade rejection remains intentional; do not add an unauthenticated WebSocket proxy to satisfy a transport the application does not use. No business use cases or SQL ownership are changed by this CI/CD work.

## Backup/PITR and shared infrastructure

The quiesced backup path remains for explicit maintenance. It now captures positive desired replica counts, checks stable availability against those counts and restores each original count on guarded pre-mutation recovery. Concurrent replica changes are rejected; full maintenance rendering also preserves existing desired counts. This does not enable permanent replica expansion without the runtime gates above. Routine no longer creates that backup or requires backup-identity impersonation. Independent online backups/PITR are an operational prerequisite to removing maintenance backups from the recovery strategy; they are not silently substituted with a live `mysqldump`.

An online design must retain MySQL binlogs with tested restoration and one transactionally consistent five-database snapshot, prohibit concurrent DDL during logical capture, retain all SQL-referenced GCS generations across the recovery horizon, and preserve the numeric JWT key version. Kafka offsets, outbox/inbox replay, processing output attempts and GC/tombstone races need an explicitly tested recovery boundary. Schedule backups only after that design and isolated restore tests pass; do not schedule the quiescing helper and call it an online backup. Configure retention/RPO/RTO against storage cost before enabling cloud jobs.

Five logical databases and separate credentials remain on one MySQL server. Kafka remains a single broker/controller. No Cloud SQL, replication topology, extra nodes or paid monitoring infrastructure is provisioned. Managed/replicated MySQL, multi-broker Kafka, PDB/topology policies and metric-driven progressive rollout require a separate capacity/availability/budget decision.

## Failure and recovery

If a stage fails, inspect `stages.json`, readiness observations, migration Job status/Flyway history and current image/template state. The workflow does not automatically roll back schema, replay side effects or blindly restart all applications. A partial release artifact remains `PENDING` and cannot serve as the next approved baseline.

For application-only rollback, review a previous approved per-service digest with current schema/contracts, then use reviewed rendered desired state through the protected environment lock. A bare `kubectl set image` is not the long-term source of truth. Reconcile a new full environment-state artifact after recovery. For schema/data issues, follow the backup/restore runbook and test restoration in isolation first.

Primary semantics: [Kubernetes rolling updates](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/), [GitHub workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), and [MySQL backup consistency](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html). These describe mechanisms, not measurements of this deployment.
