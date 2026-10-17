# Automatic rolling releases

The owner superseded the multi-workflow maintenance/routine procedure with one release button. Open **Actions → Build & deploy → Run workflow → main → Run workflow**. There are no manual inputs. [One-time setup](GKE_ONE_CLICK.md) retains the existing protected `cloud-gke` environment and identities.

## Active paths

- `ci.yml`: push/PR verification and optional manual full acceptance. The stable required check is `application`.
- `gke-build-deploy.yml`: the only manual release workflow; serializes discovery, build and rollout with `cloud-gke-deployment`, cancellation disabled.
- `cloud-images.yml`: reusable internal build/test/scan/publish implementation; no standalone dispatch button.

Removed the maintenance/deploy-digests/selective dispatch variants, separate scheduled-acceptance wrapper, quiescing GKE backup helper/identity setup/RBAC and obsolete VM deployment executables. Six application Deployments plus MySQL/Kafka/Redis remain required workloads. Migration Job templates are used on demand, not additional application Deployments. Historical VM infrastructure/backup references are retained for existing data/cutover inspection; they are not an active deploy path. No cloud resource or GitHub environment is deleted by repository cleanup.

## Automatic baseline and impact

`deployment_state.py` paginates repository Actions runs and artifacts, accepts only known release workflow paths, `workflow_dispatch`, main, successful completed runs and `rolloutStatus: PASS` evidence with a matching commit. It ignores PR/foreign workflow evidence and the current run. Interrupted mutations block subsequent releases; failures known to precede mutation can be retried. API/archive errors fail instead of silently selecting an untrusted baseline. Downloads and decompressed state size are bounded; signed storage redirects strip Authorization, and transport exceptions do not print signed URLs.

The full V2 environment state validates six immutable registry references, per-image source commit/run and matching scan gates. Its commit must be an ancestor of requested main. Live images must equal baseline images, all desired positive replicas must be ready/stable, and no previous Pods may still be draining. Missing/expired baseline means a full six-image same-run scanned release replaces the healthy existing apps sequentially; live old digests are rollback evidence only, never invented scan provenance.

Git diff handles merge-base, renames/deletions, shared inputs and immutable migrations. A Document source change builds Document; shared Maven changes build all dependent backends; frontend builds Web; app manifests can select rollout without building. Unknown/shared tooling conservatively rebuilds all six. Global quality/contracts/security and broad real-service gates remain. Publication requires full acceptance, including eight browser suites, billing saga, encrypted SQL/PITR and complete isolated LOCAL recovery. Same-commit no-image releases may reuse this exact full profile for at most24h; missing or older evidence revalidates. Registry image builds share one scoped Maven reactor, npm/Next caches and BuildKit layer reuse; scans bind to exactly selected image IDs before publication. No measured CI speedup is inferred from caching configuration.

Config-only changes are discovered at deploy time: effective per-service config hashes and Pod annotations select all changed consumers automatically, and trusted-proxy changes select Web. Google client changes force a Web rebuild. All six desired templates can be rendered for comparison, but only selected Deployment resources are applied. A no-op release records current approved state without restarting apps.

## Compatibility and migrations

`infra/k8s/rolling-migrations.json` pins reviewed expand-compatible migration resource hashes, normalized for checkout newlines. Every service resource must match its canonical `backend/schema/<owner>` copy. Existing migration edits/deletions are rejected by Git impact. New SQL requires a versioned hash-bound review in the same protected PR; the deployment button has no compatibility checkbox. Hash review is an approval record, not an SQL lock analyzer or proof of mixed-version correctness. Review MySQL lock/algorithm behavior and exercise real old/new readers before approving new SQL.

On first baseline adoption, owning migration Jobs run Flyway's pending history using the reviewed current set. Subsequent releases run only changed owners. Jobs use unique run/attempt names and migration-only images, never delete another run's Job, and an active migration prevents overlap. Flyway stays disabled in normal service startup. Protocol/native/event changes conservatively fail before publication until split into staged backwards-compatible changes; there is no maintenance fallback. Image rollback does not reverse SQL or external side effects.

## Rollout and evidence

Every selected resource must pass server dry-run before ConfigMap/Job/Deployment mutation. Existing desired replica counts are preserved. Backends roll sequentially before Web with `maxSurge: 1`, `maxUnavailable: 0`, minReadySeconds10, backend preStop10/grace160 and Web preStop210/grace360. The gateway drains bounded requests up to its configured deadline. Existing cluster capacity must accommodate surge and terminating Pods; no replicas/nodes are provisioned by CI. The existing GKE BackendConfig must match the reviewed130s request/150s drain budget before mutation. It is read, never applied by the app workflow; the60s detach allowance needs measured staging acceptance.

EndpointSlices for all six apps and public HTTPS health are sampled throughout rollout. Old Pods must finish draining before success. Unselected Deployment/template/Pod identities must stay unchanged. Authenticated save/reopen, VIEWER denial, subscription/export traffic and an in-flight bounded slow download are now additional release gates. Their evidence does not replace measured GKE collaboration/worker overlap, historical saga replay or arbitrary-user acceptance. Single-node MySQL/Kafka remain shared failure domains.

`deployment-evidence` contains bounded before/after identifiers, previous/new image/provenance state, stage results/durations and readiness samples. It excludes arbitrary Pod environment values, credentials, migration output and document data. State remains `PENDING` after interrupted mutation and becomes `PASS` only after rollout and observer completion. Artifact retention is 90 days. Do not approve failed state or delete evidence to bypass recovery checks.

## Recovery outside deployment

The release workflow no longer creates or requires a quiesced backup. Backup identities, object storage writes, JWT access and Pod exec are absent from deploy. Existing encrypted recovery objects/keys must be preserved. Independent online snapshot/binlog capture, encrypted archival, existing-runner schedules and isolated recovery tooling are implemented in [RELEASE_RESILIENCE.md](RELEASE_RESILIENCE.md). The scripts preserve five SQL owners, generation references and numeric JWT version; actual GCS/PITR/provider recovery and measured production RPO/RTO remain PENDING. No backup infrastructure is provisioned by local commands.

After an interrupted mutation, inspect bounded stage evidence, actual Deployments and Flyway history. Recover only compatible desired application state under the environment lock, then reconcile a new audited full V2 state. Never automatically scale old apps, roll back schema or retry unreviewed migrations. Live cloud acceptance, restore and numerical availability results remain in [PROJECT_STATUS.md](PROJECT_STATUS.md).

Image-only incident recovery uses hash-bound plans, live Flyway verification, DDL fencing and a temporarily frozen deployment workflow. The protected `GKE_RECOVERY_STATE` override reconciles only the exact interrupted mutation after approved traffic checks. See [the operator procedure](RELEASE_RESILIENCE.md#interrupted-release-and-approved-image-recovery).
