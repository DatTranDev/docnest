# Release assurance and independent recovery

Normal updates still use **Actions → Build & deploy → main → Run workflow**, without inputs. These changes add application acceptance, bounded traffic evidence and operator recovery. They do not provision infrastructure or certify production zero downtime. Execution results and outstanding gates belong only in [PROJECT_STATUS.md](PROJECT_STATUS.md).

## One-time release setup

Use two dedicated synthetic accounts in the existing application. Configure `ROLLOUT_OWNER_EMAIL`, `ROLLOUT_OWNER_PASSWORD`, `ROLLOUT_VIEWER_EMAIL`, and `ROLLOUT_VIEWER_PASSWORD` as protected `cloud-gke` environment Secrets. Keep human/customer accounts out of synthetic tests. The button requires no additional input. Credentials, document bodies, capabilities and SQL never enter release artifacts.

The owner account keeps two small-purpose fixtures: a reusable save/export document and one immutable eight-MiB native document for a slow download. Reusing them avoids consuming the document quota on every release. The viewer must remain read-only. Traffic preparation fails before rollout when credentials, quota, ACL or the existing fixture are invalid; it never silently rewrites an unexpected fixture.

Apply the reviewed **existing** BackendConfig update and the updated deploy Role before the next cloud acceptance. Do not apply the entire optional ingress example to an existing cluster: it also contains a load balancer, certificate and network resources. The specific backend change is:

```bash
kubectl --context "$CONTEXT" -n editor-lab patch backendconfig editor-web --type=merge \
  -p '{"spec":{"timeoutSec":130,"connectionDraining":{"drainingTimeoutSec":150}}}'
```

This is an operator command, not an action performed by local validation. The deploy Role adds only `get` on the named BackendConfig. Deployment cannot change ingress, read Secrets, execute in Pods or change database infrastructure.

## Drain and traffic bounds

`infra/k8s/drain-policy.json` is the shutdown budget checked by the generator, tests and rollout preflight. Web uses backend drain150s plus an initial NEG-detach budget60s, giving preStop210s. Shutdown135s plus margin15s gives termination grace360s. Internal backends retain preStop10s/grace160s. Request timeout remains130s. The60s detach allowance is a planning budget, not a measured GKE result. A new template cannot lengthen an already-running old Pod's preStop; validate the initial drain transition in a controlled environment before promoting it. Measure actual detach latency and long requests before approving numerical availability claims. See [GKE ingress configuration](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/ingress-configuration).

Rollout checks the actual BackendConfig before application mutation. It samples all six services from a single EndpointSlice inventory plus public HTTPS readiness. In parallel, synthetic clients verify JWT/me, private listing/read, VIEWER denial, durable native save/reopen, same-key retries, subscription reads and Kafka-backed exports. A third client reads eight MiB slowly through the public gateway; its request starts before mutation and must finish byte-exactly. Long requests are reported separately from ordinary-request p95/p99. Intentional throttling is excluded from those percentiles; errors and interrupted transfers still fail the gate. The initial ordinary-request budget is p95≤5s and zero failed synthetic requests.

This does not prove every user journey, GCS upload behavior, arbitrary CRDT conflicts or multi-worker failover on GKE. The full browser suite separately exercises real collaboration restart, reconnect, unsaved-journal recovery and convergence. Real MySQL/Kafka tests cover leases, inbox/outbox and saga retries. Actual rolling overlap and capacity remain staging acceptance gates.

## Independent deployment proof

First deploy the infrastructure/tooling release as its actual affected scope. After that successful baseline, use a real backwards-compatible change owned only by Document. Do not change shared contracts, native codecs or migrations for this proof. Run the same button, download its bounded evidence, and check:

```bash
gh run download "$RUN_ID" --name deployment-evidence --dir testing/reports/document-release
python tooling/scripts/release_evidence.py testing/reports/document-release --expect document-service --source-service document-service
```

Also inspect the exact selected build/scan provenance: only Document may have a new image. The five unrelated digests, template hashes, Deployment UIDs and Pod UIDs must remain unchanged. Repeat with no changes and `--expect no-op`. A same-commit full acceptance result can be reused for at most24h, only with the exact current acceptance profile and no image build. Missing, older, malformed or different-commit evidence runs full validation again. Traffic and live-state checks always run.

Use a truly Document-owned config key for config selection tests. `SNAPSHOTS_BUCKET` is shared by Document, Processing and Collaboration. General common-code changes select all five backends; native/codec/event changes remain blocked until staged compatibly. Do not force a narrow scope by editing detector output.

## Full local acceptance

Use JDK21, Node24, Python3.12.6+ and the pinned Python requirements. Verify Maven and build the frontend, then package the verified backend JARs for local fixtures. Web still builds inside its production Alpine environment; host native modules are never copied into musl. Cloud publication continues to build and scan its own selected immutable images.

```bash
python tooling/scripts/run.py test
npm run build
npm run build:local
python tooling/scripts/run.py fixtures
python testing/checks/full_acceptance.py --age age --age-keygen age-keygen
```

The last command creates a fresh random Compose project and removes only that project's new volumes. It does not restore/delete the user's existing app data. Test environment paths, ports and restart commands follow that isolated project. This avoids polluted smoke quotas and configured Stripe keys. It runs migration-only checks, real API/Kafka smoke, billing saga, all eight browser suites, actual Workers, slow transfers and complete isolated LOCAL recovery.

Cloud publication now requires full acceptance. It no longer treats the runtime-only profile, which skipped browser/saga checks, as complete promotion evidence. `ci_timings.py` records completed job/step durations; parallel durations are not summed. [The recorded six-service baseline](benchmarks/cicd-baseline.json) is not a cold/warm or single-service comparison. Measure the new cloud run before claiming a speedup.

## Online backup on an existing independent runner

Deploy never invokes backup, pauses all writers or scales apps to zero. `online_backup.py` is operated independently. A trusted existing Linux runner needs Docker, MySQL8.4 clients, gcloud, kubectl, pinned age and the repository Python requirements. Docker access grants substantial authority on that runner: isolate it from unrelated workloads. Pin the reviewed MySQL server UUID in its configuration and use a protected TLS MySQL defaults file; keep the age private identity offline, separate from the upload identity.

Review `infra/backup/least-privilege.sql`, `reader-rbac.example.yaml`, `runner.example.json` and the systemd service/timer examples. They are templates, not an installed backup service. The MySQL account can read the five owned databases, fence DDL and read/rotate binlogs; it cannot change application rows or schema. The backup Kubernetes identity reads only the six named Deployments and mounted JWT Secret, without Pod exec. Scope GCP access separately: get source generations from the two data buckets, access the one JWT Secret, and create objects in the independent recovery/evidence prefixes. Do not give deploy this identity.

Capture uses one `mysqldump --single-transaction --source-data=2` across all five InnoDB databases while holding `LOCK INSTANCE FOR BACKUP`. That fences DDL, not ordinary transactions. Establishing binlog coordinates can briefly take a global read lock; measure write latency, rather than claiming impact-free backup. SQL is restored into an owned disposable MySQL before collecting its required object generations. Missing generations or mismatching native hashes reject the capture. References are never taken from later live SQL reads. A numeric Secret Manager JWT version must match the mounted key. Stable images/templates are checked across cloud capture.

Only an age-encrypted archive is uploaded with generation-match0. The receipt means **CAPTURED**, not application recovery approved. The example schedule captures hourly and archives closed, checksum-verified ROW binlogs every5min. A shared local lock and atomic cursor prevent concurrent cursor advancement; a crash/stale lock requires inspection. Snapshot and archive failures leave success metrics unchanged. Proposed initial retention is14d for recovery material and365d for release evidence; enforce it only after reviewing byte growth, current prices and the remaining USD300 budget. Source-object retention/GC must cover the recovery window. No source retention policy or paid storage setting is changed automatically.

```bash
python tooling/scripts/backup_schedule.py --config /etc/docsnest/backup.json
python tooling/scripts/backup_schedule.py --config /etc/docsnest/backup.json --mode binlogs
```

For a SQL-only drill, use the explicit snapshot and complete binlog boundary from its protected manifest/receipt:

```bash
python tooling/scripts/online_restore.py --snapshot /secure/snapshot.age \
  --binlogs /secure/binlogs-first.age /secure/binlogs-next.age \
  --identity /offline/age-identity.txt \
  --stop-time '2026-10-17 01:00:00'
```

The timestamp is UTC. Supply consecutive archives in capture order, without duplicate or missing batches. Every server UUID, file hash, authorized byte range and closed-file continuation cursor is checked before replay. A later hourly snapshot can lie inside a file archived from position4: replay starts at the snapshot's exact coordinate, then continues at position4 in each subsequent file. Older files in the first batch are verified and omitted. An archive whose authorized range begins after the snapshot coordinate is rejected. This preserves the independent binlog cursor across hourly snapshots; do not reset that cursor to force a match. Checksums, archive paths, ciphertext integrity and all five schemas remain required. The official minimal server image lacks mysqlbinlog; the isolated tools image extracts the matching8.4.7 client from an official signature-verified RPM. Use the exact recovery tooling, not an older MariaDB decoder. This SQL chain does not prove that GCS generations created after the base snapshot are available for application PITR.

For a base GCS snapshot, export reviewed plaintext only to an explicit protected directory, then reuse the existing generation-aware isolated object remap:

```bash
python tooling/scripts/online_restore.py --snapshot /secure/snapshot.age \
  --identity /offline/age-identity.txt --export-protected /secure/isolated-restore
python tooling/scripts/cloud_backup.py restore-objects --allow-online-snapshot \
  --directory /secure/isolated-restore --project "$RESTORE_PROJECT" \
  --target-snapshots-bucket "$RESTORE_SNAPSHOTS" --target-results-bucket "$RESTORE_RESULTS" \
  --confirm-isolated-restore
python tooling/scripts/cloud_backup.py prepare-remap --allow-online-snapshot \
  --directory /secure/isolated-restore
```

Online archives remain labelled nonquiesced; this opt-in does not relabel them. These commands prepare five owner-specific guarded SQL patches; they do not import SQL, start apps or replay events. Review target isolation and preserve original generations, event IDs, optimistic revisions and native hashes. Never upload plaintext or the age private identity to Actions. Do not use the legacy quiesced capture command in routine deployment.

SQL PITR alone is insufficient for application PITR. Later binlog transactions can reference object generations absent from the base archive. Full PITR promotion requires generation coverage for the target time, the matching key/image/schema state and an actual isolated application drill. The tool refuses to export an unreviewed PITR SQL result as a complete object-remappable recovery point. See [MySQL PITR requirements](https://dev.mysql.com/doc/refman/8.4/en/point-in-time-recovery-binlog.html).

## Application recovery and replay

Restore into isolated databases, buckets, namespace/origin and Kafka, with Stripe disabled. First verify schema/checksums, exact GCS generation remaps, original JWT/JWKS and native bytes. Then test login, save/reopen, exports, subscriptions and asynchronous completion. The local drill exercises these against real LOCAL storage and five databases; it does not certify GCS or provider recovery.

An online snapshot is one SQL point, not a global SQL/GCS/Kafka/Stripe commit. Preserve inbox/outbox, saga generations/receipts and job state together. Published events may already have escaped the snapshot boundary. Do not blindly reset publication flags or connect restored consumers to the original broker. Reconcile retained broker offsets/events against SQL inbox/outbox; replay original validated business event IDs under the existing idempotency rules. Review expired worker/checkpoint leases and unfinished upload tickets. Provider charges/refunds require receipt reconciliation and manual review; SQL restore never reverses them.

Record the observed loss window and end-to-end restoration time for the tested scenario. SQL-only elapsed time is not application RTO. An hourly base plus5min binlog timer is not a proven5min application RPO. Full GCS/PITR, historical event replay and production RPO/RTO remain blocked until measured.

## Interrupted release and approved image recovery

Keep failed `environment-state.json`, predecessor state, `before.json`, stages, availability and traffic artifacts. Inspect actual images, Deployment UIDs/templates, owning Flyway histories, active/failed Jobs, endpoints, restarts, consumer lag and durable queues. An image rollback is eligible only if actual current schema, event contracts and native readers remain compatible. `mixed_version_check.py` exercises actual old/new images on the candidate schema in a disposable stack; its HTTP pass deliberately leaves event compatibility unverified. Nontrivial changes also need representative DDL lock/copy/duration tests and a resumable bounded backfill plan. Existing SQL files remain immutable. Hash review alone is not runtime proof.

Temporarily disable the existing deployment workflow and wait for every queued/running deployment before operator recovery. This is the exclusive incident window; normal releases keep the same button. `release_recovery.py execute` checks the freeze through Actions and fences MySQL DDL. It never changes SQL, config, replicas, Secrets or external effects. Configuration/template drift blocks image-only recovery. For an already-complete healthy new release, `--target current` instead prepares a read-only reconciliation: all six images and server-normalized template hashes plus the desired ConfigMap hash must match the failed attempt. It applies no workloads. Older evidence without those hashes requires a manual audit; hashes are never invented. The plan binds the exact failed/predecessor state, current UIDs/resource versions, tested image sets and five actual Flyway hashes. Approval is explicit and expires within1h; stale state and concurrent changes reject the operation.

```bash
python tooling/scripts/release_recovery.py plan --context "$CONTEXT" \
  --project "$PROJECT" --region "$REGION" --repository "$REPOSITORY_URL" \
  --failed /secure/failed/environment-state.json --before /secure/failed/before.json \
  --baseline /secure/previous/environment-state.json --compatibility /secure/compatibility.json \
  --mysql-defaults /secure/mysql-reader.cnf --output /secure/recovery
```

Review the plan and real schema/event evidence. Set `approved` only after review, then use `execute` with the same arguments plus `--approval /secure/recovery/recovery-plan.json`. Export the four traffic Secrets and `ORIGIN`, `GITHUB_REPOSITORY`, `GH_TOKEN` through the protected operator session. Successful recovery requires authenticated traffic and all-service availability, not just a completed patch. A partial attempt remains PENDING.

Store the resulting full recovered state in protected environment Variable `GKE_RECOVERY_STATE` after review, then re-enable the workflow. Discovery accepts it only when it binds the exact failed-state hash, the chosen previous/current image set and configuration hash, with traffic/compatibility evidence. It cannot bypass a different interrupted release. Remove the override after the next normal successful release. Never edit failed artifacts to PASS or automatically reverse SQL.

## Observability, retention and availability

All five services allow anonymous GET only on the existing private `/actuator/prometheus` endpoint. The public gateway still blocks actuator/internal routes. Kafka metrics hooks resolve the registry lazily after initialization so distribution customizers and meter binders are applied; see [Spring processor initialization](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/beans/factory/config/BeanPostProcessor.html). Standard `http.server.requests` histograms include completed asynchronous HTTP requests and support p95/p99; the existing `editor.http.duration` dispatch timer remains available separately. Existing durable outbox/queue and Kafka metrics remain. `infra/monitoring/` provides private scrape/network examples and alerts for availability,5xx, latency, pool timeouts, lag, backlog, migrations, restarts and stale/missing backup captures. Web/LB status and latency also need the existing load balancer's telemetry; backend histograms alone do not measure every gateway response. Database-pool timeout is not every SQL error: inspect bounded SQL-error logs as well. kube-state-metrics, node-exporter textfile collection and alert delivery must already exist or receive a separate capacity/cost review. These files alone do not install monitoring.

`archive_release.py` encrypts required successful main-run artifacts into an immutable independent recovery/evidence prefix before Actions expires them. Run it from the independent runner with read-only Actions and create-only bucket access. Config-only/no-op archives include the referenced image build/scan runs and the reused full-acceptance run, rather than requiring nonexistent image artifacts on the current run. Missing or expired referenced evidence rejects the archive; preserve the chain before its oldest required Actions artifacts expire. Define retention and check retrieval/key recovery; do not assume90-day artifacts survive an incident months later.

The optional availability overlay raises only Web/Identity/Document to two replicas and adds PDBs. Per-service topology spread stays in generated templates so subsequent routine releases preserve it. Workers, Redis, MySQL and Kafka are not scaled. SQL claims, fencing, immutable generation deletes and durable idempotency still need actual overlap/capacity acceptance before expanding workers. PDBs govern voluntary disruption, not rolling-upgrade guarantees or single-database/broker HA.

```bash
python tooling/scripts/capacity_report.py --context "$CONTEXT" --profile availability
```

This only reads allocatable resources and Pod requests. Its worst-case bound includes terminating replicas, surge and conservative init requests. It is not a scheduler simulation or measured load test. Do not increase nodes/replicas or claim HA solely because a manifest renders. Keep capacity, current cost and the USD300 total-budget review as explicit cloud gates.

Runtime image remediation and outstanding Medium/Low findings are reviewed in [SECURITY_OS_TRIAGE.md](SECURITY_OS_TRIAGE.md). No vulnerability exception is granted.
