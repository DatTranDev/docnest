# Project status

Last updated: 2026-10-16. This is the sole human-readable project status checkpoint. Detailed design and contracts remain in `docs/` and `docs/contracts/`. Validation commands create ignored machine-readable output under `testing/reports/` when needed.

## Application

The local application is implemented: Next.js/React/CodeMirror frontend, Java/Spring Boot Identity, Document, Processing, Collaboration and Payment services, five separate MySQL databases, Kafka outbox/inbox, Redis, local storage, and local cloud-adapter contract coverage. Authentication, folders/documents/trash, rich-text editing, native save/version/conflict handling, offline drafts, account/public sharing, previews, exports, Docker Compose, and cloud deployment preparation are implemented. Account collaboration is opt-in and bounded as described in the latest section below. Local Docker Compose has nine healthy services on the final acceptance check. Start with `python -X utf8 tooling/scripts/run.py up` after the prerequisites in `README.md`; open http://localhost:8080. Stop while preserving data with `python -X utf8 tooling/scripts/run.py down`.

## Validation completed

The results in this section predate the 2026-10-08 fixture/E2E removal. Current checks are recorded in the latest section below.

- Frontend unit/property tests: 27 editor-core + 21 web; no failures or skips.
- Current production Worker protocol, navigation and lifecycle checks: PASS.
- Real-service Playwright E2E: 10 cases, including two-user save/reopen, folders, sharing/revocation, conflicts, versions, exports and refresh: PASS.
- Repository quality gates and `npm run build`: PASS.
- OpenAPI/event/kit validation: PASS at the previous checkpoint; rerun status is below.
- Seven production browser benchmark workloads: full 5 warmups, 30 timing samples and 1000 input samples per workload; original fixtures/content checked; separate fresh memory cohorts. Results below use the full seven-workload run. A same-source, full-count dense-only repeat is retained in the machine-readable evidence.
- Java acceptance rerun after relocation: 89 JUnit tests passed, zero failures/errors/skips, including actual MySQL/Kafka/Redis Testcontainers coverage.

## Historical full large-file benchmark (2026-10-05)

| Workload / metric                           |  Previous |   Current |   Target | Status |
| ------------------------------------------- | --------: | --------: | -------: | ------ |
| Million lines, steady RAM increase          | 302.6 MiB | 201.0 MiB | ≤256 MiB | PASS   |
| Unicode near 10 MiB, steady RAM increase    | 316.3 MiB | 173.5 MiB | ≤256 MiB | PASS   |
| One million style runs, steady RAM increase | 421.5 MiB | 248.8 MiB | ≤256 MiB | PASS   |
| Dense-style 10 MiB, scroll p95              |   28.7 ms |   30.2 ms |   ≤20 ms | MISS   |
| One million style runs, scroll p95          |   22.1 ms |   18.1 ms |   ≤20 ms | PASS   |

Dense-style also misses undo/redo p95 (60.5 ms vs ≤50 ms) and steady RAM increase (304.2 MiB vs ≤256 MiB). Its same-source repeat measured 54.7 ms and 274.9 MiB respectively; scroll was 28.8 ms. These are not waived as hardware limits. The 8 GiB reference-machine run is unverified; this workstation has 15.63 GiB. See `docs/11_PERFORMANCE_ACCEPTANCE.md` for measurement scope. The archived `optimization-browser-final.json` records the previous layout. A new `npm run benchmark` run produces fresh measurements, not an identical historical result; the default CI does not run the full performance benchmark.

## Cloud and remaining gates

- P12 real GCS credentials/IAM integration: PENDING.
- P14 VM deployment and P15 GKE deployment: DEPLOY_PENDING.
- Remote CI, cloud image publication/deploy and optional P16 gRPC: NOT_RUN.
- No Google Cloud resources were created and billing was not enabled. USD 300 total learning budget remains unchanged. Use `docs/CLOUD_SETUP_HANDOFF.md` when cloud work is authorized.
- Current performance misses and measurement scope are recorded in the final structured-document section below; the earlier dense-style misses remain historical evidence.

## Repository layout migration (2026-10-07)

Implementation: moved Java services and authoritative SQL under `backend/`; web/editor-core under `frontend/`; checks, benchmark runners and reports under `testing/`; operational scripts and the lint adapter under `tooling/`; contracts and agent/version documentation under `docs/`. Infrastructure stays in `infra/`. Unit tests stay beside the implementation. Root build and workspace configuration remains for standard Maven/npm commands.

Updated Maven/npm workspaces and lockfile, Docker image paths, Compose/CI commands, Python repository roots, Playwright paths, formatting/import/architecture gates and documentation. Historical baseline JSON remains immutable; its old source paths/hashes do not certify this layout. `docs/PROJECT_STATUS.md` is the only status checkpoint. Generated reports are ignored; browser baseline JSON consumed by comparison tools remains source-controlled under `testing/benchmark/baseline/`.

Validation completed on the relocated sources:

- `python tooling/scripts/run.py test`: PASS for quality, contracts, Maven verification (89 tests) and frontend tests (48). Quality includes 19 Node contract/boundary tests and source-size review signals. Used Python 3.12.14 with pinned quality dependencies; the system Python 3.12.5 is below the documented prerequisite.
- `npm run build`, `npm run worker-check`: PASS.
- `python testing/checks/validate_kit.py`, `validate_contracts.py`, `validate_deployment.py`: PASS. Packaged event schemas match authoritative contracts byte-for-byte. Nine Python parser tests, cloud backup checks (eight tests including 500 seeded cases), and digest checks passed. These are local checks, not proof of cloud deployment.
- `python tooling/scripts/run.py up`: rebuilt all four application images; seven default application containers healthy at localhost:8080. Existing volumes were preserved.
- `npm run e2e`: 10 passed, zero skipped/flaky/failed, 117.7 seconds against an isolated Compose project on port8082 with real MySQL/Kafka/Redis/storage. The first attempt against the existing local database returned HTTP429 on registration; the isolated rerun passed without resetting user data.
- `python testing/checks/infra_checks.py` and `python testing/checks/migration_only.py`: PASS on the same isolated project; checked database ownership, SQL/Flyway/Kafka persistence across restarts, and all three standalone migration jobs. Disposable test containers and volumes were removed successfully.
- Quick benchmark harness smoke: executed with `BENCH_QUICK=1`, `BENCH_WORKLOADS=ascii-long-line-10MiB.tedoc`, and `BENCH_REPORT_FILE=testing/reports/layout-benchmark-smoke.json` using `npm run benchmark`. Fixture hashes, browser loading and memory measurement worked. This is not performance acceptance: only three timing samples and 20 inputs; scroll p95 was 21.3 ms against 20 ms, status `MEASURED_WITH_TARGET_MISSES`. Full seven-workload acceptance was NOT_RUN during this directory-only migration; historical misses above remain open.
- Historical integrity review: all 519 files tracked at that checkpoint were accounted for; protected contracts/schema/baseline files retained identical bytes. Production Java/frontend source behavior and dependency versions/registry hashes are unchanged. `git diff --check`, final lint and formatting checks passed.

Relocation validation caught and fixed packaged classpath paths and an accidental npm registry URL rewrite before completion. Added five frontend boundary checker regression tests and packaged-schema equality validation. Cloud remains PENDING/DEPLOY_PENDING; no resources, billing changes or cloud image publication were performed.

## Repository cleanup follow-up (2026-10-07)

Rewrote the root README as a short local run guide, command list and folder map. Removed `infra/compose/nginx.conf`, a legacy config with no remaining references; the production web service uses the Next.js gateway. `infra/gcp/.terraform/` is an ignored local provider cache, not a tracked deployment source; its removal was blocked by the execution environment and it remains local. `frontend/editor-core/vitest.config.ts` remains intentionally: the editor-core npm workspace runs Vitest independently and this config limits its worker count/pool; the web workspace has a separate config for its alias and test scope. No application or test code changed in this cleanup. README formatted; no test suite was run for this documentation/config cleanup.

## CI and report cleanup (2026-10-07)

Kept `testing/` and `tooling/` because current application, quality and deployment commands use them. Moved the single status checkpoint to this document and the byte-identical browser comparison input still read by benchmark/performance tooling to `testing/benchmark/baseline/`. Nine unused historical JSON reports were dropped. `testing/reports/` is now generated and ignored; no report artifact is uploaded by the regular push/PR workflow. Removed the unused implementation-report generator and its dedicated tests, plus the duplicate unpinned Python requirements file. At that checkpoint, regular CI included source quality/contracts, Java/frontend tests, dependency/secret checks, build, real migration, smoke, Worker and browser E2E gates. The E2E gate was removed in the follow-up below. Lengthy image scans run before manual cloud image publication; extended large HTTP, replay, restart and backup drills remain runnable locally but are no longer repeated on every push.

Local validation after this cleanup: `python tooling/scripts/run.py quality` PASS (Black, explicit imports, POM/Prettier, architecture, strict TypeScript, ESLint, 19 Node checks, source-size signals and Maven Spotless); `validate_kit.py`, `validate_contracts.py` and `validate_deployment.py` PASS. The validator rendered Kustomize, parsed the workflows and checked the reduced CI gates. The full Java/frontend/E2E suites and remote GitHub workflow were NOT_RUN for this cleanup; their latest executed results remain above.

## Fixture and E2E removal (2026-10-08)

At the owner's request, removed the tracked `testing/fixtures/` and `testing/e2e/` trees, the Playwright E2E configuration/command/CI step, and golden-file-specific codec tests. Integration tests and smoke checks now generate small native inputs on demand through `testing/benchmark/native_input.py`; the browser benchmark still generates its large workloads. No browser E2E gate remains in routine CI. Earlier E2E PASS entries in this file are historical and do not describe the current test suite. Cross-language golden fixture verification was deliberately retired, reducing regression coverage for native byte compatibility. Cloud deployment remains pending.

Executed after this removal:

- `python tooling/scripts/run.py test` with Python 3.12.14 and pinned quality packages: PASS. Static contracts, Black, Java imports, POM format, Prettier, frontend architecture, TypeScript, ESLint, 19 Node checks, Maven verify and frontend tests passed. Maven ran 86 tests with 0 failures/errors/skips; editor-core ran 26 and web ran 21. The secret scan also passed. The system Python 3.12.5 cannot run Black because it is below the documented 3.12.6 prerequisite.
- `npm run build`, `npm run worker-check`, `python testing/checks/validate_deployment.py`, and `docker compose ... config --quiet`: PASS. Worker check exercised the production browser worker and App Router.
- `python tooling/scripts/run.py smoke`: PASS against the existing local Compose stack using generated native inputs. The first attempt hit a Docker Desktop host-port empty response; a web-container restart restored forwarding, then the full two-user save/reopen/sharing/revocation/export/Kafka/restart-persistence scenario passed.
- `BENCH_QUICK=1 BENCH_WORKLOADS=ascii-long-line-10MiB.tedoc npm run benchmark`: PASS for generator/serve/browser native identity and quick measurements. This is one workload with reduced samples, not full performance acceptance; the historical dense-style misses remain open.
- Offline cloud backup tests: 8 passed; isolated real-MySQL backup restoration check: PASS, with its disposable container removed. No GCS or cloud restore was executed.
- At this removal checkpoint, full browser E2E, full seven-workload benchmark, rebuilt Docker images, remote CI and cloud deployment were NOT_RUN. The browser E2E command and tests no longer exist; later Docker validation is recorded below.

## GitHub CI dependency gate (2026-10-08)

Fast-forwarded local `main` from `1ad2891` to remote `536c1c0` while preserving the staged local fixture/E2E cleanup. [GitHub Actions run #10](https://github.com/DatTranDev/docnest/actions/runs/37658519556) failed at `testing/checks/dependency_scan.py` after the remote Tomcat update. A local reproduction on freshly packaged Tomcat 11.0.26 jars queried 185 Maven runtime packages and found five OSV advisories on `at.yawk.lz4:lz4-java` 1.11.1; no package was unresolved. See ADR023 and `docs/versions.lock.md` for the selected 1.11.4 security override. The scan still fails on findings and now prints affected package/version and advisory IDs.

After the LZ4 change, `python tooling/scripts/run.py test` passed: 86 Java tests, 26 editor-core tests, 21 web tests, 19 Node boundary/gateway tests, plus all static/quality gates. Maven's incremental package step initially left old 1.11.1 jars in `target/`; `mvn clean package -DskipTests` rebuilt the three service jars, and the exact CI scanner then passed: **185 queried, 0 advisory findings, 0 unresolved**. `npm audit --audit-level=high` found 0 vulnerabilities; `npm run build`, `npm run worker-check`, deployment/digest/secret checks, Black, Prettier and diff checks passed. The clean package command skipped tests only because the full verification had already run; it was used to refresh artifacts for the scan.

`python tooling/scripts/run.py up` rebuilt all four images from current source and reached seven healthy Compose services while preserving existing volumes. `python testing/checks/migration_only.py` passed all three Flyway-only jobs; `python tooling/scripts/run.py smoke` passed the full two-user, Kafka outage/recovery and restart-persistence scenario against the rebuilt images. GitHub has not run CI on these unpushed local changes, so the remote gate is still UNVERIFIED. Cloud gates remain PENDING/DEPLOY_PENDING.

## GitHub CI follow-up (2026-10-08)

Pushed the cleanup and LZ4 fix as `cd6ce1a`. [GitHub Actions run #11](https://github.com/DatTranDev/docnest/actions/runs/37713998015) passed the test, dependency scan, audit, build and static gates, then failed in `run.py up`: a clean checkout has no `frontend/web/public` directory because its generated benchmark content is ignored, while `Web.Dockerfile` copied that path from the build stage. Added `mkdir -p frontend/web/public` before the web build in `3a29b91`. A detached clean worktree confirmed the directory was absent, and `docker build -f infra/compose/Web.Dockerfile -t text-editor/web:ci-check .` passed there; the temporary worktree and test image were removed.

[GitHub Actions run #12](https://github.com/DatTranDev/docnest/actions/runs/37714925841) on `3a29b91` completed **SUCCESS**. Its quality, 86 Java tests, 47 frontend tests, npm audit, Maven dependency scan, production build, deployment/digest/secret checks, full Compose startup, migration-only jobs, real-service smoke, browser worker check and shutdown all passed. Browser E2E remains removed at the owner's request. The full performance acceptance benchmark was not rerun in this CI fix; historical target misses remain open. Cloud gates remain PENDING/DEPLOY_PENDING.

## Editor UI refresh (2026-10-08)

Refreshed the local workspace and editor around a document canvas with a two-level title/action bar and grouped toolbar. Existing B/I/U, undo/redo, search/replace, save, sharing, versions, import, downloads, exports, and save-copy actions remain functional; the file actions are in a keyboard-accessible menu. The active editor receives the main workspace area, with a button to return to the file list. Replaced emoji file markers with SVG icons, localized visible role labels, and added responsive layouts. At this visual-only checkpoint the native style model and API were unchanged; font/size/color/alignment arrived in the follow-up below. Lists, links, headers and other Google Docs formatting remain unimplemented. The installed local `frontend-design` skill informed the visual review; it is not a runtime dependency or repository artifact.

Validation: `python tooling/scripts/run.py test` with Python 3.12.14 and JDK 21 PASS (quality/contracts, Maven verification with 86 Java tests, 26 editor-core tests and 21 web tests). `npm run build`, `npm run worker-check`, Docker web image build and healthy Compose web restart PASS. A temporary ignored browser script against real local services verified workspace/editor/search and file menu visibility, typed through the B toolbar, exercised undo/redo, saved, reopened and checked that the bold run and text survived. Desktop and narrow viewport screenshots were reviewed. Six temporary UI-review documents were moved to the smoke account's trash through the application API; they remain recoverable under the normal 14-day retention. Full performance benchmark and remote CI for this uncommitted UI change are NOT_RUN; historical target misses remain open. Cloud gates remain PENDING/DEPLOY_PENDING.

## Basic font and paragraph formatting (2026-10-08)

Added Arial, Times New Roman, Georgia, Verdana and Courier New, 8–72 pt sizes, six-digit text colors, and left/center/right/justify paragraph alignment to the editor toolbar. Extended formatting participates in model history, worker snapshots, offline draft replay, visible-range rendering, native save/reopen and server HTML export. Native V1 remains the output for documents without extended formatting; V2 adds bounded `formatting.json` with strict TypeScript/Java validation and a SHA-256 manifest field. Updated the product/editor specifications, manifest schema and ADR024. TXT export remains plain text.

Validation: the sequential `python tooling/scripts/run.py test` PASS included quality/contracts, 88 Java tests with actual MySQL/Kafka/Redis coverage, 29 editor-core tests, 22 web tests and 19 Node checks. After the final editor-core changes, 30 editor-core tests, typecheck, lint, formatting, architecture and contract checks passed. The production build and browser worker check passed. Three changed Docker images built; Document, Processing and Web restarted healthy with existing volumes. An ignored Playwright script against the real local stack applied Georgia/18 pt/#bb2244/center, saved, reloaded and verified CodeMirror styling; a real Kafka-dispatched HTML export returned all four attributes. Temporary test documents were moved to Trash. The offline rich draft replay has a unit test, but a browser offline/restart scenario was NOT_RUN for this extension.

The final-source single-workload quick benchmark on `ascii-long-line-10MiB.tedoc` passed fixture identity and quick targets: three scroll samples gave p95 17.0 ms and steady memory increase 204.2 MiB. This is a harness smoke with reduced samples, not the seven-workload performance acceptance gate; dense-style historical misses above remain open. Extended dense-rich workloads have not been benchmarked. Replace-all with more than 10,000 matches in a V2 document returns `FORMAT_REPLACE_LIMIT` to avoid silently losing sparse formatting; users can replace in smaller batches.

One attempted parallel test run failed from local native memory exhaustion while Maven/Testcontainers and Vitest overlapped. The subsequent sequential full run passed; the failure is retained in ignored local logs. Remote CI for these uncommitted changes is NOT_RUN. Cloud gates remain PENDING/DEPLOY_PENDING; no resources or billing were created.

## Embedded images and A4 page preview (2026-10-08)

Added PNG/JPEG insertion from the toolbar (2 MiB and 4096×4096 limits, 100 images/document), visible-range image widgets, image-aware undo/redo, worker snapshot synchronization and IndexedDB draft replay. A native V3 document uses a bounded, hashed `media.json` ZIP entry; V1/V2 remain readable and documents without images keep their previous format. Java validates image metadata and native structure; Processing exports embedded images in HTML and `[Image]` in TXT. No API, event, database or storage-reference field changed. Added a read-only A4 page preview using browser CSS column flow, retaining virtualized CodeMirror editing for large files. Preview is capped at 200,000 UTF-16 units, does not store page breaks, and is not WYSIWYG page editing or print output. See ADR025 and `docs/04_EDITOR_ENGINE.md`.

Validation on final image/page sources: `npm run format:check`, `npm run typecheck`, `npm run lint`, `npm run architecture`, `npm test`, `validate_contracts.py`, `validate_kit.py`, `git diff --check`, and `python tooling/scripts/run.py quality` PASS. Frontend tests: 32 editor-core and 23 web, zero failures. Full Maven `verify` PASS: 90 Java tests, zero failures/errors/skips, including actual Testcontainers services and V3 codec/HTML/TXT tests. `npm run build` and a separate `npm run worker-check` PASS. The first worker-check attempt ran concurrently with Maven/Testcontainers and its Next build exhausted local Node heap; the isolated rerun passed with eight real protocol workers. Three Docker images (Document, Processing, Web) rebuilt and the three services restarted healthy with existing volumes.

An ignored Playwright script against the real local Compose stack inserted a valid PNG, showed an 83-line document as two A4 preview pages, saved, reloaded and confirmed the image remained. A screenshot was reviewed after fixing a missing second-page paper background. Kafka-backed server jobs exported HTML with an image data URI and TXT with `[Image]`; both completed and downloaded successfully. Temporary test documents were moved to Trash. Browser offline/restart recovery of V3 images and full performance benchmarks were NOT_RUN; draft replay has a unit test. Prior dense-style performance misses remain open. Remote CI is NOT_RUN on these uncommitted changes; cloud gates remain PENDING/DEPLOY_PENDING and no paid resources were created.

Final-source quick benchmark (`BENCH_QUICK=1`, only `ascii-long-line-10MiB.tedoc`) passed generated/served/browser native hashes and reduced-count targets: 3 scroll samples p95 16.9 ms, steady memory increase 204.1 MiB, one DOM line. This is a smoke run, not the full seven-workload performance gate; dense-style misses above are unchanged. After a media-size guard was added, frontend unit tests passed again, the Web image was rebuilt and restarted healthy, and the two-page/image save-reopen plus HTML/TXT real-service checks passed again. All generated benchmark output and screenshots are ignored under `testing/reports/`.

## Image RAM reduction (2026-10-08)

The worker no longer retains image base64 through init/delta messages. Native serialization receives image data only with the pinned save request and validates positions against the matching worker text revision. The viewport and A4 preview reuse one Blob URL per displayed image instead of placing base64 data URLs in both DOM trees; URLs are revoked on image removal or editor destruction. Native V3, IndexedDB draft recovery and server exports are unchanged. Main-thread base64 and decoded browser bitmaps remain, so this is a reduction in duplicate residency, not zero-copy image storage. See ADR026.

Validation: new unit tests checked Blob URL reuse/revocation, binary bytes and the worker message boundary. Frontend suites passed with 32 editor-core and 25 web tests; TypeScript, lint, frontend architecture, production build and production browser worker-check passed. The Web image was rebuilt and restarted healthy. A real-service Playwright run verified the editor and A4 preview shared the same `blob:` URL, the image survived save/reload and the 83-line preview had two pages. Kafka-backed HTML/TXT exports passed after the change; temporary test documents were moved to Trash. A controlled before/after image-heavy browser RAM benchmark was NOT_RUN, so no numerical RAM saving is claimed. Full large-file performance acceptance and remote CI remain NOT_RUN for these uncommitted changes; historical dense-style misses and cloud pending gates remain unchanged.

## Account collaboration extension (2026-10-09)

Local implementation and executed gates: COMPLETE within the bounded ADR027 scope. Added the fourth Java service under `backend/collaboration-service`, its own `collaboration_db` migration, Yjs 13.6.33 text/formatting/image merge, local-origin undo/redo, and a per-operation IndexedDB journal that preserves offline updates from multiple tabs. Every request checks the Document ACL; public links cannot join or write. Authenticated HTTP polling runs every 500 ms. Document still owns native versions and optimistic revision checks; Kafka is not used for keystrokes. A short SQL reservation coordinates native checkpoints without keeping a database transaction open over network/storage I/O. External native changes return a conflict and preserve the room log. Existing API/event/native V1/V2/V3 fields and the original three services' database ownership are preserved.

To use: share a document with another account as **EDITOR**, open it in both accounts, and choose **Cùng chỉnh sửa** in each editor. The collaboration limit is **200,000 UTF-16 units**; the standalone large-file editor remains available at its existing limits. Updates are bounded to 12 MiB, each room to 64 MiB/100,000 updates, browser pending updates to 32 MiB, and native checkpoints to 32 MiB. The service has a 512 MiB container limit and bounded request concurrency. Joining a long operation log currently requires one HTTP read per update. These bounds and protocol behavior are specified in `docs/contracts/collaboration.md` and `docs/contracts/collaboration.openapi.yaml`.

Executed on current sources with JDK 21 and Python 3.12.14 plus pinned quality packages:

- `python tooling/scripts/run.py test`: PASS for quality/contracts, Maven verification with **95 Java tests** (0 failures/errors/skips), **39 editor-core + 25 web tests**, and Node boundary/gateway checks. The five Collaboration Java tests use actual MySQL for concurrent joins, append ordering/idempotency, checkpoint reservations, quotas and persistence, plus architecture and GCS target policy. CRDT tests include 100 randomized concurrent insert cases, selective undo/redo, overlapping changes, rich formatting, empty-paragraph alignment and Unicode/native projection. The MySQL simultaneous-join deadlock, Unicode grapheme-format boundary failure and remote-projection/local-keystroke race were fixed; the final sequential full run passed. Generated log: `testing/reports/raw/collaboration-full-test-final.log`.
- `npm run build` and `npm run worker-check`: PASS, with eight real production Worker instances, no hydration/console errors, and unchanged source hashes during the worker run. Final logs: `collaboration-build-final.log`, `collaboration-worker-final.log` under the ignored raw report directory.
- Collaboration and Web images rebuilt; eight Compose services healthy with existing volumes preserved. `node testing/checks/collaboration-browser.cjs`: PASS against the final local images for two-account offline concurrent inserts, continuous simultaneous typing, convergence, selective undo/redo, concurrent B/I, shared image, native save/reopen, same-account two-tab IndexedDB recovery after closing both tabs, service restart, viewer write denial, revocation and anonymous denial. Synthetic documents are moved to Trash after the test. Final log: `testing/reports/raw/collaboration-browser-final.log`. CI now executes this focused browser check after its real-service smoke; the previously removed general E2E/fixture trees remain absent.
- `python tooling/scripts/run.py smoke`: PASS for the existing real-service application scenarios: authentication/refresh/logout, private folders, native save/reopen/idempotency, invalid upload rejection, sharing/revocation/conflicts, public read-only viewing, TXT/HTML exports, Kafka outage/outbox recovery, trash/restoration and restart persistence. Log: `testing/reports/raw/collaboration-app-smoke-final.log`.
- `python testing/checks/infra_checks.py`: PASS with all four owners accessing their own DB and denied all twelve cross-database combinations, unchanged Flyway history/SQL volumes after MySQL and service restarts, and Kafka topic persistence. `migration_only.py`: PASS for all four cloud-profile Flyway-only entry points with unchanged installed histories (2/2/3/1 migrations); no runtime service startup. Logs: `collaboration-infrastructure-final.log`, `collaboration-migrations-final.log`.
- `validate_contracts.py`, `validate_kit.py`, `validate_deployment.py`, and `digest_check.py`: PASS. Both OpenAPIs are validated, all four schema owners are included, Kustomize renders, and the five-image digest policy rejects mutable/partial/foreign references. Cloud rendering produced ordered config, secrets, four migration jobs and five applications using explicitly synthetic test digests; no resources were applied. These are static/local checks, not cloud deployment proof.
- `cloud_backup_check.py`: eight offline tests PASS. `cloud_backup_mysql_check.py`: isolated real-MySQL four-schema restore/remap PASS, including byte-preserved Collaboration V1 operation logs; disposable container removed. Full four-database `run.py backup`/`restore` on the existing user-populated local lab was NOT_RUN to avoid rolling back user data. The earlier three-database full restore proof remains historical. No GCS backup/restore executed.
- `dependency_scan.py`: **185 runtime packages queried, 0 packages with advisories, 0 unresolved**, across four packaged Java services. `npm audit --audit-level=high`: 0 vulnerabilities. `image_secrets.py`: PASS for all five application images, nonroot runtime and no generated credentials/private PEMs in configuration or first-party payloads. OS image scan was NOT_RUN for this extension; the manual cloud image workflow still enforces it before publication.
- Source-size review remains informational: four handwritten files above 500 lines and ten functions above 100 lines. Reviewed their responsibilities; codec/model/controller orchestration stays cohesive, with CRDT transport and journal in separate modules. Rules were not weakened or broadly suppressed.

Measured final collaboration boundary sample: `node testing/benchmark/collaboration.cjs` executed one real-browser sample with 200,000 ASCII UTF-16 units. Join was **1,383.3 ms**, additional main-page JS heap after GC **0.405 MiB**, and **one DOM line**. The 200,001st character was rejected in both rendered editing and saved native content. CDP JS heap excludes worker heaps, native/browser/process RAM and decoded images; this single sample has no performance acceptance target and does not prove the ≤256 MiB browser RAM requirement. Evidence is ignored `testing/reports/collaboration-benchmark.json`. The runner now registers/reuses the existing smoke account so it also works after a fresh startup; trying a separate benchmark account hit the existing local account quota (429), and account quotas were preserved. Full seven-workload performance acceptance was NOT_RUN for this extension; historical dense-style misses remain open.

Remaining limitations/gates:

- No presence/remote cursor UI, WebSocket transport, automatic CRDT log compaction/reset/deletion or multi-instance/load acceptance. Remote CRDT projection materializes the bounded document; no 10 MiB collaborative performance claim. Standalone large-file behavior retains its previous measured limitations.
- A crash after Document commits but before the room head is finalized requires manual recovery/native copy; preserve the operation log and never silently reset/rebase it. Automatic cross-service checkpoint reconciliation is not implemented.
- Java persists bounded opaque Yjs bytes; it does not semantically validate the CRDT server-side. Clients fail closed on invalid projection and Document validates native saves, but a malicious authorized editor can corrupt a room. No public write access.
- Cloud templates, IAM/KSA separation, five image workflows, four migration jobs, health checks, backup/restore, rollback and cleanup handoff cover Collaboration. GCS resumable capability forwarding is implemented with strict Google host/bucket policy and no forwarded user JWT. Real GCS checkpoint integration is **PENDING** credentials, cloud rollout **DEPLOY_PENDING**, and remote CI on these unpushed changes **NOT_RUN**. No Google Cloud resources, billing, cloud image publication or deployment occurred. The USD 300 total learning budget remains unchanged.

## Payment/subscription and saga extension (2026-10-09)

**Local implementation and executed gates: COMPLETE. Actual Stripe sandbox acceptance: PENDING credentials. MCP OAuth: PENDING. Cloud: DEPLOY_PENDING.** Selected **Payment orchestration** for the subscription entitlement workflow (ADR028): one durable coordinator can account for all participants, retry unfinished phases and compensate permanent rejection. Independent preview/export processing retains its existing event-driven outbox/inbox. Authentication, document/native contracts, ACLs, CRDT behavior and database ownership remain intact. Free retains current features/quotas until specific plan benefits are defined; the catalog is FREE, PRO_MONTHLY and PRO_YEARLY.

Implemented:

- Fifth Java service `backend/payment-service`, own `payment_db`, server-configured recurring Stripe Prices, hosted Checkout/Customer Portal, period-end cancel, signed raw-byte webhook receipts and current-state reconciliation. API and supported snapshot webhook version is pinned to **2026-09-30.endive**. Pro requires an active configured subscription, paid latest invoice and future period. Return URLs and webhook timestamps do not grant access. HTTP bodies are bounded to 1 MiB for webhooks/provider responses and 8 KiB for other billing requests; the provider deadline includes body receipt. Live keys/events are rejected.
- Durable customer mappings, account leases, request idempotency/body-conflict checks, private request/status APIs and bounded five-request queues. Unknown expired provider outcomes enter review and prevent new customer creation when its mapping is missing. Browser request keys survive lost responses/reload until server acknowledgment; hosted navigation accepts only Stripe Checkout/Portal hosts. The workspace **Gói dịch vụ** modal has private polling, recovery, focus/escape handling and a usable mobile layout. Authentication tokens remain in memory.
- Four independent entitlement participants in Identity/Document/Processing/Collaboration. Each commits domain mutation, inbox receipt and reply outbox together in its own DB. Payment commits intent/state/command outboxes together; publication ACK precedes marking and Kafka offset ACK follows the local commit. Monotonic generations fence stale commands/replies. Unfinished phases replay stable commands every minute; repeated commands republish the same stored replies without duplicating business effects. Permanent rejection restores the previous entitlement at a higher generation and queues a durable period-end cancellation when an external subscription exists. Financial state remains MANUAL_REVIEW; this does not automatically refund a charge.
- Eight private command/reply topics/schemas with original event envelopes, exact SASL principals/groups and redacted invalid-event DLQs. Added Identity V3, Document V3, Processing V4, Collaboration V2 and Payment V1 migrations; older applied migrations remain immutable. Domain policies own request eligibility and saga decisions; infrastructure performs short locked SQL and technical transport only.
- Compose/CLI, six-image workflows/digest checks, five cloud migration jobs, dedicated Payment KSA, protected Stripe configuration, health, backup/restore, rollback and cleanup handoff. No billing/resources, registry pushes or cloud deployment occurred. USD 300 total learning budget remains unchanged. See [Stripe setup](STRIPE_SETUP.md) and [cloud handoff](CLOUD_SETUP_HANDOFF.md).

Executed validation (JDK 21, Python 3.12.14, pinned tools):

- Full `mvnw -B -ntp verify`: **119 Java tests PASS, 0 failures/errors/skips** (12 common, 21 Identity, 29 Document, 34 Processing, 7 Collaboration, 16 Payment). After moving final eligibility rules into domain policy, `mvnw -pl backend/payment-service -am verify` passed all 16 Payment + 12 common again. Tests include actual MySQL concurrency/idempotency/leases, inbox/business/outbox rollback, compensation/replay, 200 seeded reply permutations, raw HMAC and bounded HTTP adapter contracts. The provider HTTP tests use a loopback server, not Stripe.
- `run.py quality`: PASS for Black/format/POM/explicit Java imports, strict TypeScript, ESLint, frontend import boundaries, 19 Node contracts/gateway checks and Spotless. `npm test` final successful root run had **39 core + 31 web**; the subsequent final billing-key test and web rerun passed **32 web tests**. Core sources were unchanged. First root run had one existing property test exceed its 5-second timeout under load; the unchanged rerun passed and rules were not relaxed. Source-size review remains informational: four cohesive files above 500 lines, eleven functions above 100 lines; the new saga acceptance runner has one sequential scenario responsibility. No suppressions or skipped tests were introduced.
- `npm run build`, final `npm run worker-check`, all six Docker image builds and updated Payment/Web rollout: PASS. Worker check used eight real production Workers, unchanged source hashes and no hydration/console errors. Full Compose startup preserves existing volumes. Windows LF bootstrap failure was fixed; shell regeneration preserves Unix bytes.
- `python testing/checks/billing_saga_check.py`: **PASS on final images** for real gateway authorization/disabled-provider/body-limit behavior, broker outage/durable outbox/no early Payment activation, four participant commands/replies over SASL Kafka, duplicate reply replay, Payment restart persistence, higher-generation downgrade/late-message fencing, schema-invalid redacted DLQ/no inbox/no raw payload logs, foreign participant topic read denial, and permanent Identity rejection with higher-generation compensation. These are explicitly SQL-seeded test entitlement intents with no Stripe customer/subscription IDs. Smoke owner is restored to Free. This gate is not Stripe sandbox proof. Kafka console-consumer reports authorization errors with exit 0; the gate checks the explicit broker error and absence of records. Harness CLI errors were corrected before the final passing run.
- `python tooling/scripts/run.py smoke`: PASS for two-user auth/refresh/logout, private folders, native save/reopen/idempotency, sharing/revocation/conflicts, public read-only access, real Kafka TXT/HTML exports, outage/outbox recovery, trash/restoration and restart persistence. `node testing/checks/collaboration-browser.cjs`: PASS for the existing concurrent/offline/format/image/native/journal/restart/ACL scenarios. `node testing/checks/billing-browser.cjs`: PASS before and after infrastructure restart for real login/Free state, disabled Checkout/Portal, no-store polling, focus/escape/unmount and mobile layout; screenshot reviewed.
- `infra_checks.py`: PASS for all five owners and all **20** cross-database denials, SQL/Kafka volume persistence and unchanged Flyway histories after restart. `migration_only.py`: PASS for all five cloud-profile Flyway-only entry points, installed histories **3/3/4/2/1** unchanged; no runtime application startup in the jobs.
- Standard OpenAPI/event/native validators, kit/deployment/Kustomize/digest checks: PASS. Twelve schemas match packaged resources; six-image digest policy and five migration jobs are included. Static rendering is not cloud deployment evidence.
- Eight offline backup tests PASS. `cloud_backup_mysql_check.py`: isolated real MySQL **five-database mysqldump/restore PASS**, preserving payment requests/receipts/compensating saga/generation/inbox/outbox, all four entitlement projections and CRDT bytes. Disposable container removed; the existing user's lab was not restored/rolled back. Real GCS backup/restore is NOT_RUN.
- Source and six-image secret scans PASS. Maven OSV: **185 runtime packages, 0 advisory packages, 0 unresolved**; npm audit: zero vulnerabilities. Final Trivy scan of actual six image IDs has **0 High/Critical**, with **40 Medium + 4 Low in each Java image and 1 Medium in Web** (201 Medium/20 Low total). High/Critical gate PASS; overall scan is SCANNED_WITH_FINDINGS, not vulnerability-free. Infrastructure images/exploitability are outside this scan.

Evidence is generated/ignored under `testing/reports/raw/billing-*` and the focused JSON reports. This file remains the sole project checkpoint. No commits/push were made for this task; remote CI is NOT_RUN on these unpushed changes.

Remaining limits/external gates:

- Actual Stripe sandbox Checkout for both plans, Portal, renewal/test-clock/payment failure, provider duplicate/reordered webhook delivery and provider outage/recovery are **PENDING** the test API key, two recurring Price IDs and webhook signing secret. Locally tested HTTP/HMAC contracts do not certify Stripe's live API. No live billing implementation acceptance is claimed.
- Local Codex Stripe MCP is configured/enabled at `https://mcp.stripe.com`; inspection reports **not_logged_in**. Complete `codex mcp login stripe` and reload the Codex session to expose tools. Suggested Stripe plugin/app is a separate unconfirmed connection. Installed Stripe CLI was 1.37.3; current CLI setup instructions require updating older versions.
- Pro feature/quantity benefits are unspecified, so no existing feature was newly paywalled. Plan switching, trial, discounts, immediate cancellation, refunds and operator billing UI are outside this catalog. Review compensation/unknown financial outcomes explicitly; SQL restore cannot reverse Stripe purchases. Missing customer mappings after uncertain creation require reviewed repair rather than a new POST. Paid summaries expire at stored expiry; periodic provider reconciliation runs every five minutes with webhook wakeups.
- No multi-instance/load acceptance or automated billing-record retention/GC. Monitor private durable saga/outbox/review state and database growth. The single broker/MySQL lab is not highly available. Earlier collaboration checkpoint/manual recovery and dense-style performance misses remain visible above. Full large-file performance benchmark was NOT_RUN for this billing extension.
- Actual GCS/IAM, HTTPS cloud rollout and cloud spending/cost validation remain PENDING/DEPLOY_PENDING. Static checks, placeholders and test digests never count as deployment.

## English/Vietnamese interface — 9 October 2026 (local acceptance complete)

Implemented typed English/Vietnamese catalogs and persistent locale selection across auth/workspace/public views, dialogs, billing, formatting/search/page preview, dates/counts and notices. Stable message IDs replace Vietnamese save/sync comparisons. Switching reconfigures CodeMirror labels without replacing editor state or image URLs. Feature-owned constants now hold account input limits, font defaults/options/style bits, clipboard bounds/chunk size, page bounds, autosave/draft/ACL timing, collaboration limits/polling, billing timing/Stripe domains/paid-plan choices, link lifetime and save retries. Existing API/native/database/event fields are unchanged.

Executed validation:

- `npm test`: **78 tests PASS** (39 core/property + 39 web, including seven localization tests). Catalog keys/placeholders, interpolation without normalization, invalid locale fallback, singular/plural numbers, stable pending notices, unknown/prototype error fallback and a TypeScript AST guard against Vietnamese literals outside catalogs are covered. The guard also found native language names left in the selector; those were moved into both catalogs before the passing run.
- Final `run.py quality`: PASS for Black/POM/Java imports, Prettier, strict TypeScript, ESLint, frontend boundaries, 19 Node lint/gateway contracts and Spotless. Source-size signals remain four files over 500 lines and eleven functions over 100 lines. Reviewed the controller as the cohesive transaction/CRDT/render boundary, catalogs as separate language data, and the focused browser runner as one sequential acceptance scenario; no suppressions or relaxed thresholds were added.
- `npm run build`, final Docker Web build/rollout and `npm run worker-check`: PASS. Eight real production Workers, unchanged source hashes during the check and no hydration/console/page errors. Nine Compose containers remain healthy, with existing volumes retained.
- `node testing/checks/i18n-browser.cjs`: PASS on the final Web image against real services. VI/EN login and existing error translation, persisted cookie/server HTML language, localized document prompt, offline unsaved edits/undo/redo with identical editor node and Worker count, search/replace and singular match labels, fonts/alignment/images/native save/reopen, real Kafka TXT job/download, history/page/share/public labels, stable Blob URLs, read-only public editing and mobile billing layout. The TXT assertion was corrected to the existing documented `[Image]` export semantics before the final passing run. Disposable test documents are moved to trash using current metadata revision; the initial harness's wrong cleanup endpoint was corrected.
- `node testing/checks/collaboration-browser.cjs`: PASS for two-user offline concurrency, selective undo/redo, formatting/image/native save/reopen, same-account draft journals, service restart, VIEWER denial, revocation and anonymous denial. `run.py smoke`: PASS for two-user auth/refresh/logout, folders, native/idempotency/conflicts, sharing/public/revocation, actual Kafka TXT/HTML jobs, broker outage/recovery, trash/restore and restart persistence.
- `run.py contracts` and `validate_kit.py`: PASS for API/native/event/document checks. No service/database/event/native contracts changed. Existing Java runtime implementation was not changed and its full Maven verification was not repeated for this frontend extension; final Java format checks passed.

The CI now includes the focused bilingual browser gate. Remote execution remains NOT_RUN until these changes are pushed; no commit/push was made. Generated evidence stays ignored under `testing/reports/raw/i18n-*`. Full large-file benchmarks were NOT_RUN for this extension; historical measured misses remain above, with no new RAM/latency claim. Stripe sandbox credentials and cloud gates remain PENDING/DEPLOY_PENDING, with no cloud resources created or budget change.

## Common document formatting — 9 October 2026 (local acceptance complete)

Added Normal/Title/Subtitle/Heading 1–6 appearance presets, font size increase/decrease, atomic clear formatting (including Ctrl/Cmd+backslash), highlight/apply/remove color, strikethrough and mutually exclusive super/subscript. The new character-toolbar component owns these related controls; English/Vietnamese labels and small UI state stay separate from canonical data. Presets operate on whole selected paragraphs; clear affects selected characters or pending typing styles. Both preserve text, images and alignment and undo as one operation. Undo back to the saved snapshot now restores the Saved caption. The optional priority question had no reply; this extension prioritized character formatting and records paragraph features as gaps below.

Native V4/sparse-v2 stores optional background/strike/script properties in sparse runs; it uses the V3 entry set with empty media when needed. V1–V3 retain their shape, encoding and validation. Java validates exact attributes/types/colors/script values/grapheme boundaries, and HTML export, viewport/A4, worker snapshots, drafts and Yjs projections preserve them. Default strike=false is removed on import before choosing the legacy writer, without normalizing legacy color casing. Clear-format normalization clones surviving runs so imported adjacent records cannot mutate earlier history snapshots. See ADR030, the updated native schema/editor contract and reader-before-writer/compatible-rollback notes in the cloud handoff. No SQL migration, API/event field, owner boundary or dependency change.

Executed validation:

- Full `mvnw -B -ntp verify`: **122 Java tests PASS, zero failures/errors/skips**, including 14 common and 35 Processing. New checks cover valid V4, rejection in legacy versions, unsafe colors/unknown fields/incorrect boolean or script types/surrogate splits, and escaped HTML with allowlisted styles. Existing actual MySQL/Kafka/inbox/outbox/ACL/concurrency/architecture gates passed.
- Final `npm test`: **87 tests PASS** (48 core + 39 web). New tests cover native roundtrip/removal of extended properties, atomic paragraph presets and selection boundaries, grapheme-safe clear/undo, pending formatting, immutable imported runs, 100 generated clear-range oracle cases, Unicode CRDT convergence and serialization after concurrent independent attributes. The first overlapping Maven/frontend run hit the unchanged compact-storage property's 5-second timeout; the final sequential run passed with no threshold relaxation, skip or test replacement.
- Final quality, strict TypeScript, ESLint/import boundaries, Prettier, Java imports/Spotless and 19 Node contracts: PASS. Four files exceed 500 lines and sixteen functions exceed 100; reviewed the cohesive native decoder, CRDT projection, viewport/rendering and toolbar functions. Related new controls were extracted by responsibility; no suppressions were added. Standard native/OpenAPI/event validators and kit validation PASS.
- All six image builds and reader-first local rollout PASS; final Web rebuild includes the import-default and Saved-caption fixes. `npm run worker-check` PASS on final worker sources with **eight real Workers**, unchanged hashes during the run and no hydration/console/page errors. Existing volumes retained and all nine containers healthy.
- Final `i18n-browser.cjs` PASS on the final Web image: presets and size steps, mutual super/sub selection, highlight/strike/script V4 save/reopen, clear/undo/Saved state, real Kafka TXT and HTML downloads with asserted CSS/content, A4/history/share/public viewer, offline edits/worker/Blob URL preservation and mobile bounds. Desktop screenshot reviewed; disposable documents moved to trash.
- Extended `collaboration-browser.cjs` PASS for actual two-user offline concurrent highlight versus strike/subscript, convergence, native save/reopen, image/formatting, selective undo/redo, same-account journal recovery, service restart and VIEWER/revocation/anonymous denial. `run.py smoke` PASS for two-user auth, folders, legacy native byte-exact save/idempotency/conflicts, public/sharing/revocation, actual TXT/HTML jobs, broker outage/outbox recovery, trash/restore and restart persistence.

Remaining feature gaps: semantic heading tags/outline/TOC (presets currently set appearance only), bullet/numbered lists, paragraph indentation/line spacing, hyperlinks, tables, stored page breaks, headers/footers and DOCX/PDF interchange. System rich clipboard still carries the existing B/I/U payload; new run properties are preserved by native save/copy/history, not cross-application rich paste. Full large-file benchmarks and fresh image vulnerability scans were NOT_RUN for this extension; earlier performance misses and security findings remain visible and no new RAM/latency/security-clean claim is made. Cloud/Stripe gates stay PENDING/DEPLOY_PENDING; no resources, purchases, commits or pushes. Remote CI remains NOT_RUN. Generated evidence stays ignored under `testing/reports/raw/formats-*`; this file remains the sole checkpoint.

## Structured documents and office exports — 9 October 2026

Implementation and functional local acceptance: COMPLETE. Final large-file benchmark: **MEASURED_WITH_TARGET_MISSES**, not a passed performance gate. This extension supersedes the paragraph/export feature gaps in the preceding historical section. No deployment, commit or push occurred.

Implemented bullet/numbered lists, indentation, line and paragraph spacing, HTTP/HTTPS/mailto hyperlinks, editable tables, stored page breaks, single-line headers/footers and page numbers. The bilingual toolbar's Insert menu owns links, tables and page settings; File offers asynchronous DOCX/PDF downloads alongside TXT/HTML. Direct CodeMirror block decorations render actual editable HTML tables while core text and sparse cell metadata remain canonical. Tab/Enter moves between cells; formatting, image insertion, history and caret restoration use canonical selection. Public/VIEWER tables are read-only, including programmatic paste attempts. A4 preview and exports preserve list/table/link/page settings. Page breaks inside tables split grid fragments.

Native V5/sparse-v3 extends the existing five-entry native layout. V1–V4 shapes and markers remain exact; writers select the minimum compatible version. Core history, worker snapshots, offline drafts and Yjs projections preserve structure, safe links and independent page settings. Tests cover generated edit/roundtrip oracles, metadata inheritance without duplicate page breaks and independent concurrent paragraph/page/cell changes. Sparse numbering is cached without scanning the full document on every scroll.

Processing uses Apache POI 5.5.1 for actual DOCX and OpenHTMLtoPDF 1.1.37 with PDFBox/XMPBox 3.0.7 for actual PDFs. Bundled, hash-verified OFL Noto fonts support English/Vietnamese without host font or network dependencies. Generated XHTML is escaped and external renderer resource access is denied; a real HTTP listener test verifies that hyperlink targets are never fetched. Existing authorization, immutable source/output, leases, cancellation, optimistic revisions, idempotency and outbox/inbox behavior remain intact. API/event type enums and authoritative/packaged schemas are synchronized. Processing V5 adds office job types; applied V1–V4 migrations are unchanged, and both V5 SQL copies are identical. Reader-first rollout/compatible rollback instructions are in CLOUD_SETUP_HANDOFF.md.

Bounds reject rather than truncate: each contiguous table has at most 1,000 cells and 20,000 UTF-16 units; office input is at most 200,000 UTF-16 units, 2,000 paragraphs and 16,777,216 decoded image pixels. Office output is capped at 64 MiB. Large TXT/HTML/native limits remain unchanged. Simultaneous edits that cross a semantic limit require the existing manual collaboration recovery/checkpoint process.

Executed gates and evidence (generated logs are ignored under `testing/reports/raw/`):

- Full `mvnw -B -ntp verify` passed, followed by final Common/Processing verification after image/table-fragment and packaged-schema fixes. Current aggregate: **132 Java tests, zero failures/errors/skips** (Common 16, Identity 21, Document 29, Processing 43, Collaboration 7, Payment 16). Actual MySQL/Kafka/Redis/storage, outbox/inbox, concurrency, ACL and architecture gates ran. Eight OfficeExporter tests reopen DOCX with POI and PDF with PDFBox, check links/numbering/tables/images/header/footer/page counts, limits and font hashes. Rendered PDF page PNGs were visually reviewed. Evidence: `structure-maven-final.log`, `structure-processing-final.log`, `structure-schema-verify.log`.
- `npm test`: **96 tests PASS** (57 core/property and 39 web). The first canonical-URL assertion expected a missing trailing slash; the corrected expectation passes. No skips, mock replacements or relaxed thresholds. Evidence: `structure-unit-pass.log`.
- Final `run.py quality`, `npm run build`, contracts and kit checks: PASS. Black/POM/imports/Prettier/ESLint/strict types/frontend boundaries/Spotless and 19 Node contracts ran. Source-size review found four files above 500 lines and eighteen functions above 100. Reviewed native validation, atomic model/history, controller/viewport and CRDT projection, cohesive UI/session flows, streaming gateway, transactional save and legacy HTML rendering; new structure validation, table widgets, paragraph controls and office rendering have separate responsibilities. Thresholds remain informational and were not weakened. Evidence: `structure-quality-last.log`, `structure-build-final.log`, `structure-contracts-final.log`, `structure-kit.log`.
- Final Worker check: PASS with **eight actual production Workers**, unchanged source hashes and no hydration/page errors. All six images rebuilt; final reader-first rollout retains data and nine Compose containers are healthy. Evidence: `structure-workers-final.log`, `structure-schema-images.log`, `structure-schema-rollout.log`, `structure-web-paste-rollout.log`.
- Real-service `structure-browser.cjs`: PASS for paragraphs, links, tables, caret/keyboard/toolbar formatting, V5 save/reopen/A4, actual Kafka DOCX/PDF/HTML jobs/downloads, two-account offline concurrent cell edits and public read-only viewing/paste. Fixed table focus, bold redraw and width defects; the harness's link-creation status now matches documented HTTP 201. No browser errors. Evidence: `structure-browser-paste.log` and final **`structure-isolated-browser.log`** on all six final images. The populated smoke account hit its unchanged 100-document quota (including Trash), so the final rerun used an isolated Compose project on port 8082; no user data or quotas were changed. Early isolated attempts failed due to runner CSRF setup and starting Kafka consumers before topic/ACL initialization. Corrected the runner and used the documented infrastructure → topics/ACLs → services order; the final test passed. All disposable test containers, volumes and network were removed; the primary nine-container app remains available on port 8080.
- `i18n-browser.cjs`, `collaboration-browser.cjs`, `run.py smoke`: PASS for bilingual extended formatting, image/native persistence, selective undo/redo, draft journals/restart, role/revocation/anonymous denial, auth/refresh/logout, folders, byte-exact legacy save/idempotency/conflicts, public sharing, real Kafka exports, broker-outage outbox recovery, trash/restore and restart persistence. The smoke runner now follows actual trash pagination rather than assuming the target is on the first page. Evidence: `structure-i18n-final.log`, `structure-collaboration-final.log`, `structure-smoke-final.log`.
- Static deployment check: PASS after correcting the Common packaged completion-event schema. Infrastructure check: PASS for five own-database accesses, twenty cross-database denials and SQL/Flyway/Kafka restart persistence. Migration-only: PASS for all five final images with unchanged histories (3/3/5/2/1), cloud-profile exit 0 without runtime startup. Image-secret inspection: PASS for all six final images, nonroot and no generated credentials/private PEMs in configuration/first-party payloads. Dependency scan: **203 Maven runtime packages, zero advisory packages or unresolved queries**; `npm audit --audit-level=high`: zero vulnerabilities. Evidence: `structure-deployment-final.log`, `structure-infra.log`, `structure-migration-final.log`, `structure-image-secrets.log`, `structure-deps-final.log`, `structure-npm-audit.log`. Fresh OS vulnerability scanning was NOT_RUN for this extension, so previous image findings remain historical and no image-security-clean claim is made.

### Final seven-workload benchmark

`npm run benchmark` completed on the final sources at 18:06:53 Asia/Saigon on 9 October 2026: **5 warmups, 30 timing samples, 1,000 input samples per workload**, seed 42, original generated fixture hashes/dimensions verified. Intel Core i5-12450H, 15.63 GiB host RAM, Chromium 153.0.8010.12; not an 8 GiB reference-device certification. Source and instrumentation hashes were unchanged during the run. The initial partial run was aborted before the final read-only paste fix; only the following fresh full run counts as final evidence. Generated artifacts: `testing/reports/raw/structure-benchmark.json` and `structure-benchmark-final.log`.

All timing values below are milliseconds, p95 unless explicitly labeled p99:

| Workload                     |  Open | Input p95 / p99 |  Scroll p95 / p99 | Search | Serialize | Undo/redo |
| ---------------------------- | ----: | --------------: | ----------------: | -----: | --------: | --------: |
| ASCII long line 10 MiB       | 459.5 |     32.9 / 34.0 |       17.4 / 17.8 |  136.7 |     266.7 |      20.5 |
| One million lines            | 587.6 |     33.5 / 34.6 |       18.7 / 19.0 |  205.3 |     330.4 |      23.9 |
| Unicode near 10 MiB          | 486.3 |     32.9 / 34.1 |       19.6 / 21.4 |  134.1 |     344.5 |      20.7 |
| Dense-style 10 MiB           | 501.0 |     43.1 / 45.8 | **115.0 / 119.4** |  141.6 |     399.3 | **166.2** |
| 10,000 style runs, 10 MiB    | 289.7 |     32.8 / 33.5 |       17.8 / 17.8 |  136.8 |     277.0 |      22.7 |
| 100,000 style runs, 10 MiB   | 339.5 |     32.7 / 33.4 |       17.4 / 17.8 |  142.0 |     318.1 |      27.0 |
| 1,000,000 style runs, 10 MiB | 780.4 |     32.9 / 33.6 |       19.4 / 20.7 |  139.7 |     535.2 |      21.1 |

RAM is the additional summed Windows working set of Chromium and its descendants, not main-page JS heap. This full run uses the runner's default **reuse** cohort: one empty-app baseline and the same browser across workloads. Later measurements retain browser/allocator history; they cannot establish isolated per-document RAM or a causal code regression versus historical fresh-browser cohorts. No hardware waiver is applied. Observed peaks use nominal 50 ms sampling during serialization and can miss shorter transients.

| Workload                     | Steady RAM increase (MiB) | Observed peak increase (MiB) | DOM lines | Unmet targets in this cohort              |
| ---------------------------- | ------------------------: | ---------------------------: | --------: | ----------------------------------------- |
| ASCII long line 10 MiB       |                     185.9 |                        251.2 |         1 | None                                      |
| One million lines            |                     189.6 |                        206.9 |       168 | None                                      |
| Unicode near 10 MiB          |                     207.6 |                        209.9 |       137 | None                                      |
| Dense-style 10 MiB           |                 **330.5** |                        361.5 |         1 | Scroll p95/p99; undo/redo p95; steady RAM |
| 10,000 style runs, 10 MiB    |                 **336.1** |                        397.0 |         1 | Steady RAM                                |
| 100,000 style runs, 10 MiB   |                 **343.5** |                        404.2 |         1 | Steady RAM                                |
| 1,000,000 style runs, 10 MiB |                 **373.6** |                        402.1 |         1 | Steady RAM                                |

Targets: open/serialize p95 ≤2,000 ms, input p95 ≤50 ms/p99 ≤100 ms, scroll p95 ≤20 ms/p99 ≤50 ms, search p95 ≤500 ms, undo/redo p95 ≤50 ms, steady RAM increase ≤256 MiB, observed peak increase ≤512 MiB and ≤500 DOM lines. All DOM, peak, open, input, search and serialize targets passed; dense scroll/undo and four steady-memory targets did not. No fresh isolated-memory repeat or additional performance optimization was executed for this extension. Performance acceptance remains incomplete with these measured misses; earlier isolated measurements are not substituted for the current run.

### Remaining limits

DOCX/PDF **export only**; import remains TXT/native. Tables contain one canonical paragraph per cell, without merged/nested cells. Numbering is consecutive at the same depth rather than a full multilevel outline. Header/footer is one plain-text line with the default page variant. A4 is a bounded preview, not a fully paginated editing canvas. Semantic headings/outline/TOC, advanced sections and cross-application rich-paste interchange remain unsupported. PDF substitutes Noto fonts for Microsoft families; exact Word/PDF pixel parity, arbitrary scripts and color emoji are not promised. Earlier CRDT recovery/load limits remain applicable.

Actual Stripe sandbox and GCS credentials/IAM gates stay PENDING; cloud rollout stays DEPLOY_PENDING. Remote CI is NOT_RUN on these unpushed changes. No cloud resources, billing, cloud image publication or budget changes; the USD 300 total learning constraint remains intact.

## Stripe MCP reconnection — 9 October 2026

COMPLETE. `codex mcp login stripe` completed OAuth successfully; `codex mcp list --json` confirms Stripe is enabled with `auth_status=o_auth`. Stripe tools are available in the current session. A real `search_stripe_documentation` call for Java webhook signature verification succeeded and returned five documentation results, including the official webhook guide. This supersedes the earlier MCP not_logged_in checkpoint. No Stripe account objects, charges or subscription settings were changed. Actual Payment-service sandbox acceptance remains PENDING its test configuration and end-to-end provider checks; MCP authentication alone does not satisfy that gate.

## Local Stripe credentials and webhook listener — 9 October 2026

Requested MCP/secret setup: COMPLETE. MCP remains authenticated. The owner completed the separate Stripe CLI authorization for the sandbox. Its real `sk_test_` API key and actual CLI `whsec_` signing secret are configured in ignored `.env`; no secret values appear in reports/chat/source. CLI-created keys expire after 90 days. Payment was recreated with these values and is healthy; no application image or account API default was changed.

Added `tooling/scripts/stripe_listen.py`: authenticated CLI profile, test-key validation, existing-key/account mismatch refusal, exact API-version guard, atomic dotenv update, nine filtered events forwarded to the local public webhook route, Payment-only reload, exclusive listener lock and child process cleanup. CLI output is consumed privately, not logged. Runtime state is ignored under `.tools/stripe/`; credentials/temp files are ignored by Git. Run `python -X utf8 tooling/scripts/stripe_listen.py` after local app startup, keep it running, and stop with Ctrl+C. See STRIPE_SETUP.md for expiry/profile/restart details.

Executed on CLI 1.37.3: default listener reported 2025-12-15.clover and was not considered compatible. A real `--latest` listener reports **2026-09-30.endive**, matching the backend pin. The helper now requires that exact reported version before updating credentials; the owned old listener was stopped and the final listener is active with matching version. No global version setting, live key or backend verifier relaxation. Black check and Python compilation PASS. Real HTTP probes through port 8080 PASS: tampered signature → 400 INVALID_STRIPE_SIGNATURE; valid HMAC over a deliberately incompatible-version event → 400 STRIPE_EVENT_VERSION_MISMATCH. These probes create no webhook receipt or entitlement and prove local signing-secret wiring/rejection behavior, not successful provider subscription processing.

Monthly/yearly Price IDs remain absent, so Checkout remains disabled. Actual provider Checkout/Portal/renewal/saga acceptance is still PENDING; no products, prices, customers, subscriptions or charges were created by this setup. Cloud gates/budget and prior benchmark misses are unchanged. Only local configuration/helper/documentation changed; full Java/frontend suites were not repeated for this setup.

## Stripe Pro recurring prices — 9 October 2026

Requested setup: COMPLETE. The owner set monthly Pro to **USD 5/month** and explicitly selected **USD 50/year**. Used the already authorized local sandbox `acct_1SfXGX0e8Eytsr3A` and existing Product **Pro Plan** (`prod_U9Ue4KUiuLAnrE`). Created two new active licensed recurring Prices through Stripe MCP, without trials/metering or changing existing catalog objects:

| Application plan | Price ID                         |          Amount | Interval       | Lookup key                                |
| ---------------- | -------------------------------- | --------------: | -------------- | ----------------------------------------- |
| PRO_MONTHLY      | `price_1UOd500e8Eytsr3AH8JPRarC` |   500 USD cents | month, count 1 | `document_manager_pro_monthly_usd_500_v1` |
| PRO_YEARLY       | `price_1UOd580e8Eytsr3AsK77gDjW` | 5,000 USD cents | year, count 1  | `document_manager_pro_yearly_usd_5000_v1` |

Both have `livemode=false`, `currency=usd`, `billing_scheme=per_unit`, and metadata identifying application `document-manager` and the plan. Set the two matching `STRIPE_PRO_*_PRICE` variables in ignored `.env`, preserving API/webhook keys, and recreated only Payment. The local test billing catalog is now enabled; the exact API-version-matched listener remains active. No live configuration, cloud provisioning or real-money transaction occurred.

Executed validation: MCP price readback PASS; direct Stripe GETs with the actual configured test API key and pinned 2026-09-30.endive header PASS for both active prices/amounts/intervals; real port-8080 `/api/v1/billing/plans` returns enabled=true/testMode=true. Actual browser login and Subscription plans dialog PASS with two enabled registration buttons and zero page errors; **no purchase was submitted**. Payment rollout/health PASS. Generated evidence: `testing/reports/raw/stripe-prices-rollout.log` and `stripe-prices-browser.log`; secret values were never logged. Documentation formatting checked; application code/contracts unchanged, so full unit/Maven/performance suites were not repeated.

Actual sandbox purchase of each plan, provider webhooks/saga completion, Portal configuration, renewals/failure/cancellation remain PENDING. This price/configuration gate supersedes the previous missing-Price-ID/disabled-Checkout checkpoint, but does not claim the full billing acceptance gate passed. Plan-specific benefits remain unspecified. Earlier CLI-key expiry, performance misses, cloud budget/gates and remote-CI status still apply.

## Backend DTO, Repository/DAO and service contracts — 10 October 2026

Implemented across the five backend services. HTTP request records now live in feature `api/dto` packages, including strict Document/Folder/Sharing DTOs that preserve required and unknown field checks and distinguish omitted metadata parents from explicit `null`. Controllers depend on application `*Service` interfaces implemented by the existing command/query handlers. Persistence ports use `*Repository` names and their JDBC implementations use `Jdbc*Dao` names; transaction, SQL, ACL, idempotency and outbox logic remains in the same adapters. Updated architecture rules prevent controllers from importing application handlers directly. README, AGENTS, the agent guide and ADR019 now describe these boundaries. No API/event schema or migration changed.

Executed on the changed source:

- `mvnw.cmd -B -ntp spotless:apply` and the Maven compile/targeted test reactor: PASS. Targeted Java run: **22 tests, zero failures/errors/skips**, covering all five architecture suites, Identity HTTP mapping and strict Document request DTO deserialization. `python testing/checks/java_imports.py`: PASS. `git diff --check`: PASS.
- `npm run format:check`, `npm run architecture`, `npm run typecheck`, `npm run lint`, `npm test` (**96 frontend tests**), `npm run build`, both Node gateway/lint-glob test files, and `validate_contracts.py`: PASS.
- Full `mvnw.cmd -B -ntp verify`: PASS across all seven Maven modules, **136 Java tests, zero failures/errors/skips**. This includes Spring context and Testcontainers MySQL/Redis/Kafka integration tests. An earlier attempt exhausted Windows commit space; a later Payment claim test failed once and passed on isolated rerun. The final full suite passed with the application containers temporarily stopped to provide memory. The containers were restarted afterward, with all five backend services healthy and web started. Running application images were not rebuilt, so browser checks against the new source remain NOT_RUN.
- `run.py quality`: PASS with the bundled Python 3.12.14 and the pinned Black installation. Black, Java imports, POM format, frontend format/architecture/typecheck/lint, Node tests, source-size analysis and Maven Spotless check all passed. The initial quality attempt hit the host's virtual-memory limit during TypeScript; the final run passed with application containers temporarily stopped.

Generated command logs are ignored under `testing/reports/raw/dto-*`. Cloud, Stripe sandbox purchase, performance acceptance and remote CI status are unchanged; no deployment, commit or push occurred.

## Drive-inspired workspace library — 10 October 2026

Implemented the owner's screenshot direction in Writing Room. The workspace now uses a full-width white library surface on a pale blue-gray shell, a broad search field, compact navigation and a New menu. Folder tiles and document cards are distinct; cards display actual returned preview text or an honest empty/unavailable state. Grid/list preference survives reload, Type filters and visible-item name sorting work, and title search uses the existing server `titleQuery` contract while folder names are filtered across the loaded folder pages. Document pagination remains at 50 items. Item actions are grouped into keyboard-accessible menus that clamp horizontally to the viewport and open upward when needed. Owner/viewer/trash actions retain their permission rules. The editor stays mounted when returning to the library, preserving unsaved text and history. Both language catalogs and the existing browser checks were updated for the New/account menus.

Executed on the changed UI:

- Frontend unit tests: PASS, **96 tests**. TypeScript, ESLint and feature/import architecture checks: PASS.
- Production web image build: PASS, including `npm run build` and Next.js TypeScript compilation. The local web container was recreated on port 8080. Application containers were temporarily stopped for host memory during the build and restarted afterward.
- `node testing/checks/workspace-browser.cjs`: PASS against real services, covering native save/previews, keyboard focus/arrows/Escape, layout preference, name order, Type filters, server title/folder search, rename/move/breadcrumb, trash/restore, viewer action restrictions, retained unsaved editor DOM/content and mobile menu bounds. Its disposable fixture documents were trashed and fixture folders removed.
- `SMOKE_OWNER_EMAIL=smoke-recipient@editor.test node testing/checks/i18n-browser.cjs`: PASS for both languages, offline edits/history, native save/reopen, real TXT/HTML exports, share/public view, formatting controls and mobile billing access. The existing smoke account avoids the lab account quota; no quota or credentials were changed.
- `tooling/scripts/run.py quality`: PASS, including Black, Java imports, POM/Prettier format, frontend architecture/typecheck/lint, 19 Node boundary/gateway/lint-glob tests, source-size analysis and Maven Spotless across all seven modules. `git diff --check`: PASS. Generated evidence and screenshots are ignored under `testing/reports/raw/workspace-*`.

Desktop grid/list and 390-pixel mobile screenshots were visually reviewed. This is a local UI update; cloud, Stripe purchase acceptance, prior performance misses and remote CI status retain their earlier checkpoints. Backend source was not changed in this UI step; the prior 136-test Maven verification remains its evidence.

## docsnest preferences, subscription UI and Word import — 10 October 2026

Renamed the displayed product to `docsnest` in both language catalogs and page titles. Native selects now have consistent rounded controls and customizable option popups where the browser supports `appearance: base-select`, retaining native keyboard/typeahead semantics and a native fallback. File/Insert menus support keyboard navigation, outside dismissal and viewport positioning; the File popup no longer clips under the sidebar after toolbar wrapping. Subscription plans now present Free capabilities alongside a highlighted Pro panel, monthly/yearly selection and the existing hosted Checkout action. Mobile puts Pro first. Prices remain authoritative at Checkout; no unspecified paid-exclusive benefits or discounts are advertised.

Added bilingual Settings with English/Vietnamese and light/dark/browser themes. Changes persist automatically under the authenticated account ID in this browser, including an in-memory fallback when local storage is unavailable. Browser theme changes apply live; account switching restores each account's own language/theme. These preferences do not sync across devices. Dark library, editor chrome, menus and dialogs use the same palette; document paper retains its stored colors.

Added DOCX import through New and the editor's File menu, alongside TXT/native import. New imports create an owned document and return to My documents when initiated from Shared/Trash. The inert OOXML reader converts supported text, headings, inline formatting, links, lists, rectangular tables, inline PNG/JPEG and simple header/footer/page numbers into the existing canonical snapshot. It never fetches external resources. ZIP input is bounded at 16 MiB, expanded parts at 32 MiB and 512 entries; streamed decoding checks actual expansion and CRC. Canonical office limits remain in force. Unsupported complex Word layouts, merged/nested/multiparagraph cells, floating objects and tracked changes are rejected with a localized message; a failed/canceled import leaves the open document intact. Existing real Kafka DOCX/PDF exports are exposed in File and were verified by downloading and reopening their output.

Executed on the final source/image:

- `npm test`: **107 tests PASS** (57 editor-core, 50 web), including eight bounded ZIP/import tests and three preference tests. Evidence: `docsnest-unit-final.log`.
- `tooling/scripts/run.py quality`: PASS for Black, Java/POM imports/formatting, Prettier, frontend boundaries, strict TypeScript, ESLint, 19 Node boundary/gateway/lint-glob tests, source-size review and Spotless across seven Maven modules. Production web image build: PASS. Application containers were temporarily stopped to resolve the host commit-memory limit, then restarted; all nine containers are healthy on port 8080. Evidence: `docsnest-quality-final.log`, `docsnest-web-build-final.log`, `docsnest-web-recreate-final.log`, `docsnest-restart-final.log`.
- `node testing/checks/docsnest-browser.cjs`: PASS against real services for keyboard select options, importing from Shared, canonical Unicode/formatting/list/table/image/footer/PAGE save/reopen, unsupported/canceled import preservation, actual DOCX/PDF jobs and downloads, exported DOCX reimport, settings without losing the editor, persisted two-account preferences and live system theme, and desktop/mobile subscription presentation. Exported PDF text extraction verifies Vietnamese heading, table cells and footer. No page errors; the runner trashes its own disposable document. Evidence: `docsnest-browser-final.log` and `docsnest-*.png/docx/pdf`. Added this browser gate to the existing CI workflow; remote CI remains NOT_RUN.
- `SMOKE_OWNER_EMAIL=smoke-recipient@editor.test node testing/checks/i18n-browser.cjs`: PASS for bilingual formatting, offline/history/native save/reopen, real TXT/HTML exports, A4/share/public labels and mobile. The first rerun exposed an obsolete double-click in the harness: File now closes after choosing an action. Corrected the harness and the final rerun passed. Evidence: `docsnest-i18n-final.log`.

Desktop dropdown, settings, dark library and desktop/mobile subscription screenshots were visually reviewed. Backend production code and schemas were unchanged in this extension; the prior 136-test Maven verification remains its evidence. No Stripe purchase, cloud deployment, commit or push occurred. Earlier billing acceptance, performance and cloud checkpoints remain applicable.

## Introduction, standalone local editor, Markdown/code/JSON — 10 October 2026

Implemented the owner's new feature request in `features/local-tools`. `/intro` introduces docsnest with a rendered Markdown/source demonstration, feature links and a local editing entry point. `/local` requires no login and has four retained editors: canonical rich Document, Markdown, Code and JSON. Login/workspace link to the new pages. Language and local light/dark/browser appearance do not replace authenticated account preferences.

Document mode reuses the actual controller/Worker/native codec and bounded DOCX importer. Local native/TXT/HTML/DOCX downloads never use APIs; DOCX is generated with the browser-side docx library. Browser Print / Save PDF is labeled accurately and uses escaped/rendered HTML rather than a server job. Markdown provides a formatting toolbar, source/split/preview, GFM tables/checklists, syntax-highlighted fences, MD/HTML downloads and browser printing. Raw HTML is inert, unsafe link protocols are stripped and remote image loads are suppressed. Code editing has numbers, indentation, colors for JS/TS/Python/HTML/CSS/JSON and plain fallback; code is never executed. JSON has grammar validation, localized line/column errors, 2/4-space formatting and minification. It writes raw numeric/string tokens, retaining large integers, exponent notation, duplicate keys and order. Input/output/depth/token limits apply before replacement. Files are retained in the session and through explicit downloads, with dirty-work exit/replacement prompts.

`npm run build:local` builds a separate Vite multi-page site with relative script/style/font/Worker paths: `index.html` and `editor.html`. `npm run preview:local` serves it on port 8081 using only static HTTP. The distribution includes a README, third-party notices and the unchanged OFL Noto Serif font/license. No Java, database, broker, Redis or Next.js runtime is required. A ZIP and reviewed screenshots were copied to the calling chat's outputs directory. No cloud publishing or payment occurred.

Executed final gates (generated evidence is ignored under `testing/reports/raw/`):

- `npm test`: **124 tests PASS** (57 editor-core, 67 web), including 17 new JSON grammar/lossless/bounds and rendering/DOCX tests. The first core run exceeded its existing timeout with a constrained GC configuration; the final standard-memory run passed without changing tests or timeouts. The new numeric oracle was corrected to compare the actual JSON stringify/parse semantics for negative zero. Evidence: `local-unit-final.log`.
- Final `tooling/scripts/run.py quality`: PASS for formatting/imports/Prettier, strict types, frontend boundaries, ESLint, 19 Node contract tests, source-size review and seven-module Spotless. Boundaries cover 137 source modules. Source-size signals remain informational: four existing large files and 28 large functions reviewed. The local workbench owns mode/file state and view orchestration; its source controller, JSON lexer, Markdown renderer and document exporters have separate modules. No broad suppression or relaxed gate was added. Evidence: `local-quality-final.log`.
- `npm run build:local`: PASS. `local-tools-browser.cjs`: PASS against the compiled static distribution, first with all six application containers stopped and again on the final assets. Actual MD/HTML/JSON/native/DOCX downloads, Word import/export/reimport and list/table/color/bold, canceled replacement preservation, source editor DOM/history retention, syntax colors/line numbers, raw-HTML/URL/media handling, two languages/themes, offline editing/download and 390-pixel layout all ran. A subdirectory deployment initializes the actual compiled Worker and accepts edits. The test asserts **zero API requests, zero external requests and zero page errors**. Browser-generated PDF contains readable Vietnamese heading, table and code, verified with pypdf extraction. Evidence: `local-build-final.log`, `local-browser-final.log`, `local-markdown.pdf` and `local-*.png/docx/html/json/md/tedoc`. Added build/browser gates to the existing CI workflow; remote CI remains NOT_RUN.
- The first code-color browser run found duplicate CodeMirror language package instances: language supports and the highlighting facet resolved different copies. Reconciled the exact 6.13.1 pin and lock/installation so all supports use the same instance; actual Python/Markdown code colors now pass. A stale nested installed copy was preserved outside the checkout before regenerating the resolved lock, and the clean Docker npm-ci build also passed.
- Production Web image build/recreate: PASS on final source, including Next.js build/type compilation. All nine Compose containers are healthy on port 8080 after restart. Anonymous navigation through `/intro` to `/local` has zero API requests and zero page errors. Evidence: `local-web-build-final.log`, `local-web-rollout-final.log`, `local-services-restart-final.log`, `local-next-pages-final.log`.
- Final real-service `SMOKE_OWNER_EMAIL=smoke-recipient@editor.test node testing/checks/i18n-browser.cjs`: PASS for both languages, rich formatting, offline/history/native save/reopen, real TXT/HTML exports, share/public labels and mobile. Evidence: `local-i18n-browser-final.log`. `git diff --check`: PASS.

Backend source, schemas and save/share/export contracts were unchanged in this extension; the prior 136-test Java verification remains its evidence. Prior billing acceptance, benchmark/performance misses, cloud and remote-CI checkpoints remain applicable. Local PDF pagination is the browser's output and is not claimed equivalent to the server Office renderer. No commit or push occurred.

## Markdown scroll correspondence — 10 October 2026

Split view now synchronizes scrolling in both directions using rendered blocks' Markdown source lines and CodeMirror line geometry. Positions interpolate between corresponding blocks, clamp at document endpoints, and ignore their own programmatic scroll events. The map rebuilds after edits, view changes and resize; deferred preview waits for matching source content. Mobile preview has its own bounded scroll pane. Source history/caret, safe preview and local-only file behavior are preserved.

Executed for this correction:

- `npm test`: PASS, 57 editor-core + 69 web tests (126 total), including two correspondence mapping tests. Evidence: `markdown-scroll-unit.log`.
- `tooling/scripts/run.py quality`: PASS, including formatting, strict types, ESLint, boundaries (140 modules), 19 Node contracts and seven-module Spotless. Evidence: `markdown-scroll-quality.log`.
- `npm run build:local` and `node testing/checks/local-tools-browser.cjs`: PASS. The real compiled site now checks 70 mixed Markdown sections with different source/rendered heights, both directions, stable scroll positions, both endpoints, resize, view switching and 390-pixel layout, followed by the existing file/export/offline/safety gates. Zero API/external requests and page errors. Evidence: `markdown-scroll-browser.log`; test implementation: `testing/checks/markdown-scroll.cjs`.
- Production Web image build/recreate: PASS; actual Next `/local` passed the same scroll checks with zero API requests/page errors. Evidence: `markdown-scroll-web-build.log`, `markdown-scroll-web-rollout.log`, `markdown-scroll-next.log`. Refreshed the standalone ZIP; port 8081 serves the new compiled assets. Backend source and contracts were unchanged.

## Fixed preview labels, editable JSON results and managed source files — 10 October 2026

Moved the Markdown pane labels outside scroll containers while retaining source-line correspondence. JSON now has independently editable source/result panes: format/minify to the right, copy/download/edit that result, or explicitly apply it to the source. Failed formatting retains both buffers. Local downloads preserve supported source filename suffixes, including JSX/TSX.

Added sign-in/account-avatar navigation to introduction/local headers. The same-host session cookie hint contains only an initial; it makes no background auth/API calls and does not authorize workspace access. Successful login/refresh updates it; failed refresh/logout clears it. The account presentation model and subscribing hook are separate from the auth API. Static hosting can configure NEXT_PUBLIC_APP_URL for navigation.

File management creates/imports, edits, saves, downloads, filters and reopens Markdown, JSON and supported code files by filename extension. It reuses canonical text/BOM/EOL preferences, EditorController/Worker/history, native versions, signed upload/commit, SQL ACL/revision rules and offline drafts. Renaming without a supported extension preserves the previous suffix. JSON results are local scratch content until applied. No database, native-version or HTTP/event contract migration was added. Source shortcuts/clipboard use plain text; imported code/HTML is never executed.

Executed:

- `npm test`: PASS, 57 editor-core + 72 web tests (129 total). Source import/codec tests retain Unicode, BOM/CRLF, code and large numeric JSON literals and reject malformed/oversized UTF-8 files. Final scoped web rerun: 72 PASS. Evidence: `source-tools-unit.log`, `source-tools-web-unit-final.log`.
- Final `tooling/scripts/run.py quality`: PASS for formatting/imports/Prettier, strict types, ESLint, frontend boundaries (146 modules), 19 Node contracts and seven-module Spotless. Reviewed five files/31 functions over the existing informational size thresholds. WorkspaceScreen coordinates file/library/session actions; source rendering, JSON result tools, file typing, account presentation and syntax extensions have separate modules. No gate or threshold was relaxed. Evidence: `source-tools-quality.log`.
- Final standalone build and `local-tools-browser.cjs`: PASS. Real compiled assets check fixed labels through two-way scroll, editable JSON result/copy/download/apply, invalid input preservation, original TSX filename/content download and all prior local file/Word/offline/safety/language/theme/mobile gates. Zero API/external requests and page errors. Fixed a test dialog race by awaiting completion of its real dismiss action before restoring the handler. Evidence: `source-tools-build.log`, `source-tools-browser.log`, `local-*.png` and actual downloads.
- `source-files-browser.cjs`: PASS against real services and an independently served compiled static site. Create/import/save/native reopen/original-format download of MD/JSON/Python, source indentation/highlighting, large JSON result application, type filtering, offline draft recovery, newer-revision conflict with the local draft retained, viewer ACL, login/avatar/logout and mobile all ran. Local headers have zero API requests; zero page errors. The anonymous initial refresh and stale CSRF-cookie renewal return their expected authentication errors and recover. Existing disposable smoke accounts are reused; only the test's own document IDs are trashed. Added this gate to existing CI; remote CI remains NOT_RUN. Evidence: `source-files-browser.log`.
- Browser checks found and corrected TextAdapter string rendering (`slice` rather than object `toString`) and LOCAL upload URLs crossing loopback hostnames. LOCAL uploads now use the current gateway path; GCS URLs/credential isolation remain unchanged and their protocol unit tests pass. Local Compose's CSRF allowlist explicitly includes 127.0.0.1:8080 alongside its configured origin; the original exact-origin verification and cloud policy remain. `docker compose ... config --quiet`: PASS.
- Production Web build/recreate: PASS, including Next production compilation/types, and the standalone ZIP was refreshed. Evidence: `source-tools-web-build.log`, `source-tools-web-rollout.log`. Java source/schema/contracts were unchanged; prior 136-test Java verification remains its evidence. Cloud, paid billing acceptance, performance misses and remote CI checkpoints remain applicable. No commit or push occurred.
- Final `source-files-browser.cjs` rerun against the final production image and compiled static distribution: PASS. Final `SMOKE_OWNER_EMAIL=smoke-recipient@editor.test node testing/checks/i18n-browser.cjs`: PASS for bilingual rich formatting, offline/history, native save/reopen, actual TXT/HTML exports, share/public labels and mobile. All nine Compose services are healthy. Evidence: `source-files-browser.log`, `source-tools-i18n-browser.log`. `git diff --check`: PASS.

## UX/UI audit and design proposal — 10 October 2026

Completed the owner's requested business-analysis/UI review of the current frontend working tree. Added `docs/design/UX_UI_AUDIT_2026-10-10.md` with the four requested sections: current-state audit, information architecture/user flows, screen layouts and UX writing comparisons. The report contains 21 prioritized findings, English/Vietnamese copy, business dependencies, accessibility criteria and a measurement plan. Added the generated desktop/mobile editor concept at `docs/design/assets/docsnest-editor-concept.png` and its exact built-in imagegen prompt at `docs/design/UX_AUDIT_IMAGE_PROMPT.md`. These are proposals; production code was not changed.

Read current product/design/contract documentation and relevant frontend components/styles/catalogs. Reused the running local app on port 8080 for anonymous introduction/local-editor/sign-in/registration review at 1440×1000 and 390×844. The local rich editor host began at approximately y=939 at the mobile viewport; computed dark sign-in contrast was 3.55:1 for description text and 4.40:1 for the observed primary button text. Authenticated surfaces were inspected in current code, with two older repository screenshots as supporting context; no fresh authenticated walkthrough or service acceptance is claimed. Screenshot evidence is ignored under `testing/reports/ux-audit-2026-10-10/`. No account, content, sharing or payment mutations were submitted, and the temporary viewport override was reset.

Executed:

- `npm exec -- prettier --write docs/design/UX_UI_AUDIT_2026-10-10.md docs/design/UX_AUDIT_IMAGE_PROMPT.md`: PASS. An initial repository formatting check found the audit table needed reformatting after a copy correction; corrected and reran.
- `npm run format:check`: PASS across the repository after correction. Evidence: `testing/reports/ux-audit-2026-10-10/format-check.log`.
- Local Markdown validation: 47 relative links/assets resolve; all four required numbered sections present. Pillow PNG integrity check: PASS. Generated editor concept visually reviewed.
- Full Java verification, frontend unit/build/architecture gates, actual-service browser/integration/race checks and benchmarks: NOT_RUN for this documentation/design-only task; no executable changes to validate. Existing acceptance results and performance misses are unchanged. This audit does not certify the proposed redesign or paid conversion uplift.

No commit, push, cloud provisioning/deployment or billing action occurred. Cloud and paid-billing gates retain their prior PENDING/DEPLOY_PENDING state. `docs/PROJECT_STATUS.md` remains the sole project checkpoint.

## First-page header from BA reference — 10 October 2026

Added a separate first-page header in the A4 preview with an inline single-line edit field and a “Different first page” toggle. Later pages continue to use the repeating header. The existing header/footer dialog exposes the same settings. Page changes remain in the canonical formatting model, undo/history, offline drafts and collaboration settings. Native V6 (`sparse-v4`) carries the new fields while V1–V5 payload shapes and strict readers stay unchanged. Local/server DOCX and server PDF export now use the first-page variant. Added the V6 formatting schema, ADR035 and editor-engine documentation.

Executed:

- `npm test`: PASS, 58 editor-core and 73 web tests (131 total); includes native V6 roundtrip and undo/redo.
- `npm run typecheck`, `npm run lint`, `npm run architecture`, `npm run build`, `npm run worker-check`: PASS.
- `node --test testing/checks/next-lint-glob.test.mjs frontend/web/server/gateway.test.mjs`: PASS, 14 tests.
- `python testing/checks/java_imports.py`, `python testing/checks/validate_contracts.py`, Black 26.5.1 with bundled Python 3.12.14, `node testing/checks/source-sizes.mjs` (JDK 21), targeted Prettier checks, and `git diff --check`: PASS. Source-size scan reported 5 files and 31 methods/functions over informational thresholds.
- Maven Spotless: PASS. Targeted `NativeCodecTest` and `OfficeExporterTest`: PASS, 21 tests including V6 strict validation and DOCX/PDF first-page output. Web tests include a DOCX first-page-header ZIP assertion.
- Full `mvnw verify`: NOT_RUN to completion; Testcontainers stopped at Identity because this session has no available Docker environment. Real-service/browser acceptance of this change: NOT_RUN for the same blocker.
- `npm run format:check`: FAIL from the three pre-existing, untracked BA prompt/gallery Markdown files under `docs/design/`; changed-file Prettier checks pass. Those design source files were preserved without formatting edits.

Cloud, billing, remote CI and performance checkpoints are unchanged. No commit, push, deployment or cloud provisioning occurred.

## Design gallery implementation — 11 October 2026

Updated the web UI against `docs/design/ALL_SCREENS_DESIGN_GALLERY.md`: the introduction now starts a local Document and separates account saving; sign-in shows password guidance and inline field errors; library states have direct creation, retry and scoped search cues; create/rename/move/share/history use focused dialogs; managed source and JSON panes expose explicit mobile switches and guarded result replacement; the local editor has a compact mobile toolbar, editable filename and Download action; historical previews can be saved as new documents; the Downloads tray, settings/plan presentation and public source viewer reflect the gallery's written behavior notes. Owner/role, local-only, original-format and read-only limits were preserved. The existing first-page header and other in-progress editor/backend changes were left intact.

Validation on the changed source: `npm run typecheck`, `npm run lint`, `npm run architecture` (148 modules), `npm test` (58 editor-core and 73 web tests), `npm run build --workspace=@ted/web`, and `npm run build:local --workspace=@ted/web`: PASS. The compiled standalone `local-tools-browser.cjs` passed real file/DOCX roundtrip, JSON result, Markdown scroll, offline, bilingual theme and 390-pixel mobile checks with zero API/remote requests. A production Next browser smoke passed anonymous introduction → Document, native download, JSON guard/switch and registration guidance; the mobile document page began at y=231px in a 390×844 viewport, without horizontal overflow. The browser suite found and drove a fix for the heading Download popup stacking below the toolbar. Changed frontend and browser-check files pass targeted Prettier; `git diff --check` passes. Repository `format:check` remains FAIL on the three pre-existing untracked gallery/prompt Markdown files and this already-modified status file; they were preserved without wholesale reformatting.

Authenticated real-service browser acceptance and full Maven verification are NOT_RUN for this UI task; the source preview's backend proxy on 127.0.0.1:8081 was unavailable, and the running port-8080 app was not rebuilt from this source. No deployment, commit or push occurred.

## Design gallery live comparison — 11 October 2026

Rebuilt and recreated only the Compose web service from the current working tree; the local app remains available at `http://localhost:8080`. `/healthz` returned 200. Headless Chromium at 1440×1000 and 390×844 captured the gallery's 14 numbered screen areas plus the original cloud editor in `testing/reports/raw/design-gallery-2026-10-11/` (ignored evidence). The authenticated pass used an existing disposable smoke account, created four temporary documents to exercise editor, source, public-link and library states, then moved its own fixtures to Trash; a separate action pass exercised queued export and name/move/folder dialogs. Browser passes reported no page errors.

**Result: the UI does not yet match all gallery boards.** Boards 01–14 have working portions but none matches its full proposed visual/state composition. The largest differences are 02 (auth layout), 09 (sharing groups and link presentation), 10 (history side panel/recovery presentation), 13 (the configured test catalog offers Pro checkout while the board depicts unavailable subscriptions), and 14 (public reading surface and mobile text wrapping). The original 00 editor also differs materially: persistent sidebar and dense multi-row toolbar, with clipped mobile document text. Other gaps: 03 mobile grid instead of the proposed list; 04 Trash grid and no restore confirmation; 05 plain loading text rather than skeleton; 06–07 denser source controls and different mobile default panes; 08 dense local formatting toolbar; 11 import remains a native file picker/prompt; 12 tray is functional but visually simpler. The Shared/Trash and Plans comparisons use settled screenshots, not transient loading captures.

This was a live visual and primary-workflow comparison, not exhaustive acceptance of every secondary state shown on composite boards. In particular, 05 error/Undo, 09 recipient collaboration, 10 conflict/offline recovery, 11 import failure, 12 ready/failure export, and 14 invalid-link states were not re-exercised in this pass. No tracked application code changed during this comparison, and no full test suite or Maven verification was run.

## Design gallery implementation — 11 October 2026

Updated the running web app toward boards 00–14 of `docs/design/ALL_SCREENS_DESIGN_GALLERY.md`. The cloud editor now uses a wider writing surface, a compact primary toolbar and wrapped mobile text. Introduction and auth have the proposed entry hierarchy and clearer local/account choices. The mobile library has a scoped list with a one-line selector; loading, Trash restore and create/import use focused states and dialogs. Managed Markdown/code and local tools expose format controls and responsive panes; JSON result actions stay visible below the scratch editor. Sharing separates people and link access; history is a side drawer; public links use a framed reading view with mobile download. Settings and Downloads have the gallery's fuller labels and state layout. Existing ownership, revision, local-only and read-only behavior remains enforced. Board 13's Pro checkout still appears when the test catalog enables it, as required by actual catalog state rather than the unavailable-subscription illustration.

Validation: `npm run typecheck`, `npm run lint`, `npm run architecture` (149 handwritten modules), and `npm test` (58 editor-core + 73 web tests) PASS. Final Compose web build and healthy restart PASS; local app remains at `http://localhost:8080`. Browser passes on the rebuilt app captured anonymous desktop/mobile introduction, auth, local editor and JSON at 1440×1000 and 390×844 with no horizontal overflow. Earlier authenticated gallery passes covered editor, sharing/public link, history, My files/Shared/Trash, settings/plan, export, import and restore confirmation with zero page errors; action flows covered rename/move/folder. The final focused browser pass checked import filename preservation, restore confirmation and invalid public links. `local-tools-browser.cjs` passed the static local build with no API/remote requests. Evidence is ignored under `testing/reports/raw/design-gallery-2026-10-11/`.

The older `workspace-browser.cjs`, `source-files-browser.cjs` and `i18n-browser.cjs` regression checks were updated for the new dialogs and labels, but a full rerun did not complete: repeated runs exhausted their shared smoke account's document quota, and subsequent account registration hit HTTP 429. One concurrent unit-test attempt ran out of worker memory; the sequential rerun passed. Visual matching is close for the captured primary states, not pixel-exact or an exhaustive verification of every composite-board secondary state. No commit, push or cloud deployment occurred.

## Language picker visual correction — 11 October 2026

Replaced the browser-native language `<select>` with a shared app popover. It aligns to the trigger's right edge, keeps both options in a readable 160px menu, marks the current choice, closes on outside click, and supports keyboard selection/escape. This fixes the cramped, clipped-looking menu in the supplied mobile screenshot. Typecheck, lint and Compose production build pass. Headless Chromium captured the auth, intro, local editor and authenticated library menus at 390px; all menu rectangles stayed inside the viewport (right edge 311–370px of 390px). Compose web service was rebuilt and is healthy at port 8080. Evidence: `testing/reports/raw/language-*-mobile.png`.

Follow-up dropdown audit at 390×844 found the same overlap in the Settings language picker and the Move destination picker; the Share permission picker also covered the explanatory copy below it. Settings now expands the shared language menu inline, Move uses a scrollable inline option list, and Share uses inline Viewer/Editor lists. The library type filter popup remained within the viewport; removed its heavy black focused-option outline. Account, New and document action menus were captured within viewport bounds. The updated settings, move, share and type-filter states were visually checked after rebuilding the healthy web service. Typecheck, lint, targeted Prettier and production build pass. Evidence: `testing/reports/raw/dropdown-*-mobile.png`.

## Desktop library actions — 11 October 2026

Removed the duplicate “New document” and “Import file” buttons from the desktop library heading because the sidebar already has the New menu. Kept the library view switch and retained the “New document” shortcut on mobile; Import remains hidden there.

## Workspace navigation and Google sign-in — 11 October 2026

Removed Local editor and Subscription plans from the workspace sidebar. Added Google Identity Services sign-in, backend Google ID-token signature/issuer/audience/verified-email checks, per-Google-subject account linking, and app-session issuance. Token verification lives in the identity infrastructure behind an application port. The local, ignored `.env` now has the Web client ID as `GOOGLE_CLIENT_ID`; Compose passes it to identity-service and the web build. The user confirmed that `http://localhost:8080` was saved as an authorized JavaScript origin in Google Console. This ID-token flow does not use a Client secret or redirect URI.

Validation: the bundled JDK 21 ran Maven verification for identity-service and dependencies (17 common and 21 identity tests), then the targeted MySQL integration suite passed (8 tests), including Google account creation, repeat sign-in, verified-email linking and Flyway V4. The identity-service and web Docker images rebuilt and both Compose services are healthy. The Google button and Google-hosted iframe render on `http://localhost:8080`; a malformed token sent through the running app returns HTTP 401 `INVALID_CREDENTIALS`. Frontend typecheck and focused auth session tests passed earlier (9 tests). A real Google-account sign-in has not been performed, so provider acceptance remains pending.

The user supplied a corrected Web client ID; the ignored local `.env` was updated, the web image rebuilt, and both services recreated. The Google-hosted button iframe and the identity container now use that exact ID. A subsequent Google sign-in attempt reached `QUOTA_EXCEEDED`: the local database already held 10 accounts, equal to the default `MAX_USERS=10`. Compose now passes through optional `MAX_USERS` with the same default. The ignored local `.env` sets `MAX_USERS=100`, and the identity container was recreated healthy with this value; the existing 10 accounts were retained. Provider sign-in needs a retry to confirm completion.

## Select arrow alignment — 11 October 2026

The user clarified that the Type selector's arrow was vertically off-center: its former font glyph sat low when closed and high when rotated open. Restored the original native Type selector and account-menu layout after the preceding misinterpretation. The shared customizable-select picker icon now uses a small CSS-drawn chevron with controlled transforms in both states. Web typecheck, Prettier, and a rebuilt healthy Compose web image pass. A real-browser check on the running app at 1440px and 390px verified the icon states and filter selection; screenshots are in ignored `testing/reports/raw/picker-icon-*.png`.

## Editor navigation and JSON panes — 11 October 2026

The cloud editor now presents Document, Markdown, Code, JSON and Edit together as tabs above the editor. The standalone Edit together button and duplicate action in Share were removed; the tab enters the existing collaboration flow and is disabled for read-only, offline or over-limit documents. Signed-in users can double-click a document title to rename it. Return to editor was moved out of the library heading and placed above the library content. All editing modes use the active document model and existing save/version path.

The app's local editor is now embedded below the introduction at `/intro#editor`; `/local` redirects there while preserving a supported `mode` query. The independently built static local site retains its own `editor.html`. JSON formatting updates the result after source changes without pressing Format. Source and result editor tops align, and either pane can be collapsed and expanded; manually edited results stay intact until the user chooses a replacement action.

Validation: web typecheck, lint, architecture (151 modules), 74 web unit tests, static local build and `local-tools-browser.cjs` passed. The Compose web image rebuilt and restarted healthy on port 8080. A real-browser pass on the running app verified the `/local` redirect, auto formatted JSON, aligned and collapsible panes, signed-in mode tabs, title edit entry, moved Return action and mobile layout. Live entry into a small Edit together session was not exercised: the existing smoke document exceeded the collaboration size limit, while another smoke account had reached its document quota. No full Java suite, cloud deployment, commit or push occurred in this change.

## Dark library card contrast — 11 October 2026

Corrected the grid card styles so folder and document tiles use the active theme surface instead of a fixed white background; the white document preview remains a paper surface with dark preview text. The card hover now uses the theme tile color. Rebuilt and restarted the Compose web service. A signed-in dark-mode browser check measured 12.45:1 contrast between the card title and card background, and visually inspected the folder/document grid at `testing/reports/raw/dark-library-fixed.png`. Web typecheck, targeted Prettier and `git diff --check` pass.

## Compact editor return control — 11 October 2026

Moved the editor's return-to-library action into the editing mode row as a 44px back arrow with an accessible name and tooltip. This removes its separate horizontal strip while preserving the existing document-list action. Web typecheck, lint and production Compose build pass; the rebuilt web service is running at port 8080. Signed-in browser screenshots at desktop and 390px mobile sizes show the compact control and no added vertical navigation row (`testing/reports/raw/editor-back-*.png`). The existing editor-flow browser check still passes.

## Document library sorting — 11 October 2026

Added a library sort selector for creation date, name and stored native size, plus a direction toggle. The default is newest creation date first; name starts A–Z and size starts largest first. Document sorting now runs in the document service with a sort-aware keyset cursor so Load more continues the selected order. Folders retain alphabetical order ahead of documents. The API exposes `sizeBytes` for listed documents (zero before their first saved version) and accepts validated `sortBy`/`sortDirection` query parameters. The OpenAPI contract was updated.

Validation: a MySQL-backed integration test passed for name/date/size ordering across one-item pages and rejection of a cursor from another sort. Web typecheck, lint, 74 unit tests, OpenAPI/static contract validation, Java compilation/Spotless, and both production Compose image builds passed. The document and web services restarted healthy at port 8080. A signed-in browser pass verified the default selection, server name/size order, desktop/mobile controls and no mobile horizontal overflow (`testing/reports/raw/library-sort-*.png`). No commit, push or cloud deployment occurred.

The sort picker was then changed from a browser-native popup to the existing app option menu because its popup was horizontally offset from the trigger in the user's browser. The menu is now anchored at the trigger's left edge and is at least as wide. Typecheck, lint, targeted Prettier, production web build and a rebuilt healthy web service pass. Desktop and mobile browser checks measured matching left edges (within 1px), no 390px viewport overflow, and preserved server sorting; screenshots are in `testing/reports/raw/library-sort-menu-desktop.png` and `library-sort-mobile.png`.

## CI Markdown formatting repair — 11 October 2026

GitHub Actions run #38116647658 failed in `python tooling/scripts/run.py test` because Prettier rejected three design Markdown files. Applied the pinned Prettier formatter to `docs/design/ALL_SCREENS_CORRECTION_PROMPTS.md`, `docs/design/ALL_SCREENS_DESIGN_GALLERY.md` and `docs/design/ALL_SCREENS_IMAGE_PROMPTS.md`; removed a stray standalone `+` from the correction prompts. `npm run format:check` and `git diff --check` pass locally. The full local test command is NOT_RUN because Docker Desktop's Linux engine is unavailable and the active Java runtime is JDK 17 rather than the required JDK 21. Remote CI for this fix remains pending until push.

The pushed formatting fix advanced [run #38132542904](https://github.com/DatTranDev/docnest/actions/runs/38132542904) through the quality checks, but Maven exposed a fresh-checkout failure in `OfficeExporterTest`: its PDF rendering test wrote PNG evidence before creating `testing/reports/raw/`. The test now creates that directory before writing any evidence and reuses it for the PDF output. Local Maven verification remains NOT_RUN under the same Docker/JDK blockers; remote verification of this follow-up is pending.

[Run #38132842841](https://github.com/DatTranDev/docnest/actions/runs/38132842841) passed the complete repository test command, audits, production/static builds, deployment checks, Compose startup, migrations, smoke and billing saga checks. It then failed in `local-tools-browser.cjs` at a JSON Format button lookup. JSON result formatting now updates automatically, so that button is conditional. The browser check uses the always-visible Validate action for invalid input, checks preserved result content across minified/pretty layouts, and checks the translated Validate action after switching languages. The managed source-file browser check likewise waits for automatic JSON output instead of clicking the conditional Format button. The static local build and four repeated local-tools browser passes succeed; real-service source-file browser validation remains pending in CI.

[Run #38133966083](https://github.com/DatTranDev/docnest/actions/runs/38133966083) passed through the local-tools browser check, then failed in the collaboration browser check while looking for the former standalone Edit together button. The editor now exposes Edit together as a tab, so the browser check's entry selector was updated. This real-service check is NOT_RUN locally because Docker Desktop's Linux engine is unavailable.

[Run #38134992744](https://github.com/DatTranDev/docnest/actions/runs/38134992744) passed the repository tests, builds, Compose startup, migrations, smoke, billing and local-tools browser checks, but the collaboration check still waited for the former sync label, which is no longer rendered in the editor. The check now waits for each real `/join` response and selected collaboration tab before exercising its existing offline/convergence assertions. Remote verification of this follow-up is pending.

[Run #38136041473](https://github.com/DatTranDev/docnest/actions/runs/38136041473) passed the join and two-user offline insert, undo/redo, concurrent typing and bold/italic checks. It then timed out finding Highlight because extended character controls now live inside the toolbar's Format disclosure. The collaboration browser check opens that disclosure on both peers, reselects text, and continues to verify highlight/strike/subscript convergence. Local real-service validation is still NOT_RUN without the Docker engine; remote verification is pending.

[Run #38136980368](https://github.com/DatTranDev/docnest/actions/runs/38136980368) reached the extended-formatting stage but found two nested `summary` elements under the disclosure: Format and Insert content. The check now selects the Format summary by its exact visible label. All earlier gates and collaboration stages passed; remote verification of this selector correction is pending.

## Cloud preparation repair — 12 October 2026

Repaired the local cloud handoff for the current five-service/five-database/six-image application. Cloud images now receive the public Google Web client ID at build time; VM and rendered GKE configuration preserve the matching Identity client ID, reviewed account quota, exact HTTPS origin and optional sandbox Price IDs. Empty provider configuration remains disabled. Rendering rejects invalid origins/client IDs/quotas, partial Price configuration and foreign-project/service image digests before writing deployment files. The protected GKE update workflow validates and updates only the existing public editor-config ConfigMap, runs all five migrations, waits for all backend readers and then rolls out Web; its RBAC grants no Secret access.

Terraform now requires the actual cumulative budget start date, reserves/wires a VM-only static IP with a DNS output, enables the additional IAM/STS/IAP bootstrap APIs and waits for API enablement before dependent resources. GKE workload bindings exist only after the GKE identity pool exists; none/vm create no such bindings or cluster. Terraform 1.14 is the minimum for the offline plan tests. Budget amount remains USD 300. Local plan files are ignored. Cloud runbook/handoff now include all passwords/principals, six digests, five migration/restore owners, complete application quiescence and V6-compatible readers/rollback. No applied migration, public API/event envelope or business ownership changed.

Added actual offline Compose/Kustomize configuration tests to the existing deployment gate and five mocked-provider Terraform plan contracts to CI. These mocked plans never contact Google and do not certify real IAM, GCS or deployment. The Collaboration browser harness now supports dedicated disposable fixture accounts, waits for the editor and a successful poll at the joined sequence after client hydration/journal replay, observes click/response promises together and explicitly reselects the intended range before the next formatting action. Existing convergence/format/native/recovery/restart/ACL assertions remain. Diagnostics contain bounded CSS scalars only, no text/credentials.

Executed with bundled Python 3.12.14, Temurin JDK 21.0.12.1+1, Node 24.11.1 and Terraform 1.14.0:

- `python -X utf8 tooling/scripts/run.py quality`: PASS on final sources, including Black, Java imports/POM/Prettier, strict types, lint, architecture, 19 Node boundary/gateway/resolver tests, source-size review and Maven Spotless. Final evidence: `testing/reports/cloud-preparation-quality-final.log`. After the browser harness changes, `npm run lint` and `node --check testing/checks/collaboration-browser.cjs` also PASS. Source-size signals remain 7 existing files and 36 functions/methods; their editor/codec/session responsibilities were reviewed without mechanical splitting or suppression.
- `npm test`: PASS, 58 editor-core + 74 web tests (132 total). `npm run build`: PASS, production Next.js build.
- `python testing/checks/validate_deployment.py`: PASS, including five real local Compose/Kustomize rendering tests. `validate_contracts.py`, `validate_kit.py`, `digest_check.py`, `scan_secrets.py`, Black checks and `git diff --check`: PASS.
- `terraform -chdir=infra/gcp init -backend=false -input=false -lockfile=readonly`, `fmt -check -recursive`, `validate` and `test`: PASS. Five offline plans verify none/vm/gke isolation, reserved-IP wiring/DNS output, configured budget start and invalid date/origin rejection. No live plan/apply was run.
- `python testing/checks/migration_only.py`: PASS against all five current local images and real MySQL, preserving installed histories 4/3/5/2/1 and exiting without runtime startup. Evidence: `testing/reports/cloud-preparation-migrations.log` and `migration-only.json`.
- `node testing/checks/collaboration-browser.cjs` with two dedicated disposable fixture accounts: PASS for offline/concurrent edits, selective undo/redo, B/I/extended formatting, image, native save/reopen, same-account journal recovery, service restart, viewer denial, revocation and anonymous denial. Evidence: `testing/reports/cloud-preparation-collaboration-browser-final-check.log`. The check trashes its own documents; one leftover from an earlier unhandled failed run was also moved to that fixture account's recoverable Trash.
- `mvnw.cmd -B -ntp verify` with JDK 21 and the repository's bounded MAVEN_OPTS: PASS, **141 Java tests**, zero failures/errors/skips (17 common, 23 Identity, 34 Document, 44 Processing, 7 Collaboration, 16 Payment), including actual MySQL/Kafka/Redis tests and architecture. Evidence: `testing/reports/cloud-preparation-maven-recovered.log`.

Failed attempts are preserved in the ignored cloud-preparation logs: Docker was initially unavailable; after starting Docker Desktop, Windows native/commit-memory exhaustion crashed Maven forks and one lint process. A temporary pause of the six local app containers did not immediately fix that exhaustion; all six were resumed and nine Compose containers returned healthy. The final bounded Maven run after memory recovered passed. Earlier browser attempts hit the existing shared-account document quota, timed out before hydration, failed extended-format selection or journal recovery, or timed out on an ordinary navigation click; the final strengthened harness passed without relaxing quotas/assertions. An intermediate static-IP test could not evaluate a computed plan value; its mock override now applies during plan and all five final contracts pass.

Remote CI for this local change, exact cloud image publication/scan, real Google sign-in on the cloud origin, Stripe sandbox acceptance, GCS integration, VM/GKE rollout and remote restore remain **NOT_RUN/PENDING/DEPLOY_PENDING** until executed in those environments. Performance target misses remain open. No commit, push, billing change, paid resource creation or deployment occurred.

## CI portability and redundant assets — 12 October 2026

[Run #38266075496](https://github.com/DatTranDev/docnest/actions/runs/38266075496) passed repository quality/tests, dependency audits, production/static builds and deployment rendering, then failed Terraform validation because the locked Google provider had only the Windows `h1` checksum. Generated official signed provider locks with `terraform -chdir=infra/gcp providers lock -platform=linux_amd64 -platform=windows_amd64`; provider version remains 6.50.0 and CI retains read-only lock verification. When refreshing providers, run this command for both supported platforms before committing the lockfile.

Moved the unchanged offline Terraform gates into a separate 10-minute job and added workflow/ref concurrency cancellation for superseded runs. All application gates remain enforced. Removed four superseded first-pass design PNGs (4,950,892 bytes); the gallery now links their existing corrected `-v2` boards and Git history retains originals. Docker context now excludes design documents/assets, host-only checks and GitHub workflows; application source, packaged contracts and fonts remain included.

Local validation: Terraform read-only initialization, recursive format check, validation and all five offline mock-provider plan tests PASS; `validate_deployment.py` (including five real Compose/Kustomize rendering tests), `validate_kit.py` (including documentation links), `scan_secrets.py`, targeted Prettier and `git diff --check` PASS. No application implementation changed. Full application validation will run on GitHub after the user-authorized commit/push; its result remains PENDING until that exact commit's jobs finish. Cloud provisioning/deployment remains DEPLOY_PENDING.

[Run #38267343375](https://github.com/DatTranDev/docnest/actions/runs/38267343375), commit `95226f7`, passed the Linux Terraform job, full repository quality/tests, audits, builds, configuration checks, stack startup, all migrations, smoke, billing saga, local-tools browser and collaboration browser. It then exposed the previously blocked billing UI harness: paid controls are now hidden when Stripe is disabled and the dialog opens through the account menu. Repaired five browser harnesses against the current UI: language menus, exact Format disclosure, labelled import dialog, editable-title heading text, document IDs instead of preview-enriched accessible names, Download menu/tray, editable first-page header, actual collaboration join/ready polls and desktop visibility of the standalone sign-in link. Actual TXT processing is still checked through authenticated Kafka jobs, while HTML/DOCX/PDF use the current UI; completed job state is polled through authenticated requests before download. Existing recovery, optimistic conflict, read-only ACL, formatting, export bytes, account preferences, focus, polling and mobile assertions remain.

Local real-service validation: `billing-browser.cjs`, `i18n-browser.cjs`, `docsnest-browser.cjs`, `source-files-browser.cjs` and `structure-browser.cjs` all PASS. Dedicated disposable fixture accounts avoid modifying existing users' files; each document-producing harness trashes only its own IDs. Billing/DOCX no-purchase checks temporarily used an ignored Compose override disabling local Stripe, and the original Payment configuration was restored in `finally`. Source-file tests observed expected initial unauthenticated refresh and a recovered signed-CSRF rejection during logout; zero page exceptions and successful logout were asserted. Prettier, lint, deployment rendering (five tests) and `git diff --check` PASS. No application source, API, schema or provider acceptance claim changed. Remote verification of the repaired harnesses remains PENDING until the next exact-commit CI run completes.

## Manual VM build and rollout — 13 October 2026

Added the owner-requested **Build & deploy VM** manual workflow, reusing complete
CI and the existing six-image scan/publication workflow. Build-only remains
available. The same-run release manifest records commit/ref, immutable images,
public Google Client ID and V6 compatibility. The VM deploy identity uses OIDC,
OS Login and IAP; one-time setup scopes OS administration to the existing VM,
IAP to its internal IP/SSH port and service-account use to its runtime identity.
No Google JSON keys, paid resource provisioning or push-triggered deployment are
added. Preserved and completed the already pending manual build-button changes.

The root host script validates protected config, release/archive bounds and
current health, holds a deployment lock, pulls before downtime, quiesces all six
apps/HTTPS, captures five databases/exact GCS generations/stable JWT version,
encrypts with an external age public recipient and uploads to the private backup
bucket before migration. It runs five separate migration-only commands, starts
backend readers before Web and checks public health. Secrets/domain remain on
the VM; per-release source and digest env overrides do not reset the initial
checkout. A systemd service survives an SSH disconnect. Previous app recovery
is automatic only before migrations or when actual captured/current Flyway
histories match; schema changes, native-format upgrades, SQL restore and Stripe
reconciliation require operator recovery. Fixed cloud Compose's JWT startup
path explicitly; the binary cloud profile previously overrode JWT_KEY_PATH and
looked under /run/secrets despite the installed /data/keys volume.

Executed locally with Python 3.12.14, JDK 21 and real Docker:

- `python -X utf8 tooling/scripts/run.py test`: PASS, including quality/contracts,
  Maven verification with **141 Java tests** (zero failures/errors/skips), **58
  editor-core + 74 web tests**, strict types/lint/architecture and gateway/resolver
  contracts. Log: `testing/reports/vm-deploy-full-test.log`.
- `npm run build`: PASS, production build; `vm-deploy-build.log`.
- `validate_deployment.py`: PASS, five actual Compose/Kustomize rendering tests
  (including explicit Identity key path) and nine new offline VM tests for
  archive traversal/link rejection, output redaction, backup/migration order,
  backup/readiness failure recovery and changed-schema fail-closed behavior.
  These simulated orchestration faults do not certify Google deployment.
- `cloud_backup_check.py`: eight tests PASS; `cloud_backup_mysql_check.py`: PASS
  against a disposable actual MySQL 8.4.7 instance, including five-database
  dump/restore, Payment saga/inbox/outbox, CRDT bytes and exact reference remapping;
  its disposable container was removed. No remote GCS restore ran.
- `validate_contracts.py`, `validate_kit.py`, `scan_secrets.py`, Black, Prettier,
  Bash syntax checks for both setup helpers and `git diff --check`: PASS.
  Source-size review remains seven existing large files/36 functions; the new
  rollout code adds no threshold signal. No gate was relaxed.

The owner supplied execution evidence for Singapore project/buckets/registry,
a VND budget corresponding to approximately USD 300, VM/static IP, five cloud
migrations and eight healthy backend/infrastructure containers. Independently
read GitHub run [38364821152](https://github.com/DatTranDev/docnest/actions/runs/38364821152)
on `7c4110c`: CI, scans and six-image publication succeeded. These are previous
manual execution results, not validation of this new automated rollout. Public
Web/HTTPS, real GCS functional acceptance, Google/Stripe provider acceptance,
encrypted remote backup/restore and the new GitHub/IAP/systemd workflow remain
PENDING/DEPLOY_PENDING until actually executed. Performance misses remain open.
This local task ran no cloud provision, image publication or deployment.

## CI bootstrap repair and lighter routine checks (2026-10-13)

The owner requested fixing CI and reducing routine tests. Read failing GitHub
run [38404751484](https://github.com/DatTranDev/docnest/actions/runs/38404751484)
on `f4334f9`: Terraform, quality/contracts/Maven/frontend tests, dependency scans,
production/static builds and offline deployment checks passed; local Compose
startup failed because MySQL became unhealthy. A fresh isolated real MySQL
instance with the init script installed as Linux mode 0644 reproduced
`MYSQL_ONETIME_PASSWORD: unbound variable`. MySQL sources non-executable init
scripts; our top-level `set -u` leaked into its entrypoint. Wrapped bootstrap in a
subshell, preserving strict credential validation and five separate databases.
The same fresh-server test then passed all five actual database owner logins;
the disposable container and anonymous volume were removed. Existing application
volumes and credentials were untouched.

Push/PR and default manual validation keep all core quality/contracts,
Java/ArchUnit/Testcontainers and frontend tests, scans and production/static
builds. Six-image local Docker builds/startup, migration-only, smoke and Worker
checks run for cloud builds through an explicit reusable-workflow input. The
seven browser suites and billing-saga fault tests run only when manual
`full_acceptance` is enabled; their source files remain available. Exclusion from
a routine run does not count as browser/billing acceptance evidence. Static
workflow contracts guard the defaults, always-on core steps and required cloud
runtime checks. VM rollout's encrypted backup/migration/health gates and image
publication's security scans remain enforced.

The first local test/build attempt ran concurrently and exhausted native memory
in Java and Next's ten build workers. Tests/build are retried sequentially;
Next build concurrency is capped at two workers to bound local/CI build memory.
This setting changes build concurrency, not the application runtime or tests.

Executed locally with Python 3.12.14, JDK 21 and Docker:

- `python -X utf8 tooling/scripts/run.py test`: PASS on the sequential retry,
  including all quality/contracts, **141 Java tests** with zero failures/errors/
  skips and **58 editor-core + 74 web tests**. Log:
  `testing/reports/ci-light-test-sequential.log`.
- `npm run build`: PASS with two actual page/build workers;
  `ci-light-build-sequential.log`. `npm run build:local`: PASS.
- Fresh mode-0644 MySQL bootstrap and five owner logins: PASS after the fix,
  FAIL with the old script's leaked `MYSQL_ONETIME_PASSWORD` shell option.
- `validate_deployment.py`: PASS for the new CI mode contracts, five actual
  Compose/Kustomize checks and nine VM rollout tests. Final Next config ESLint,
  strict TypeScript, Black/Prettier, Bash syntax, secret scan and diff checks: PASS.
- Full seven-suite browser/billing acceptance and cloud runtime build: NOT_RUN
  this turn; they require their explicit manual/cloud workflow modes. This is
  not a new browser/cloud acceptance claim.

Remote GitHub CI [38409822430](https://github.com/DatTranDev/docnest/actions/runs/38409822430)
on repair commit `d44e3f84915d44477c894c2cb61b8de1dec8882d`: **PASS**,
completed 2026-10-13 14:07 UTC. Both Terraform and application jobs succeeded;
all core tests/scans/builds/static deployment checks passed. The explicit
Docker/browser exclusions in this push mode behaved as configured. This is
routine CI evidence, not full browser/cloud runtime/deployment acceptance.
No cloud provisioning, image publication or deployment was requested/executed.
The previous cloud/provider/restore and performance acceptance gaps remain open.

## Fresh-data Singapore GKE learning guide (2026-10-13)

The owner selected a separate GKE learning lab with new data, retaining the
existing VM/data/domain. Added `docs/GKE_SINGAPORE_LAB.md` with all Cloud Shell
commands: tested six-image digests, one zonal Standard node, existing scoped
node/runtime accounts, separate private GCS buckets/CORS, existing numeric
secret versions, SQL/Kafka/Redis, five migration jobs, backends before Web,
new HTTPS host/DNS/OAuth origin, required real functional checks, scoped manual
GKE update workflow prerequisites, and node/LB/disk cleanup. Creating via gcloud
keeps it outside the current VM Terraform state; changing the existing selector
to gke would instead plan VM/IP removal. Reviewed official current management
fee/free-tier, forwarding-rule, disk/network and alerts-only budget sources;
compute/disk/log/traffic totals require the Singapore calculator/account SKUs.
The USD300 total budget is unchanged; parallel VM+GKE adds a full node's cost.

Fixed Kubernetes Identity startup to explicitly select `/keys/identity-key.pem`
from its existing Secret mount; the cloud binary default previously pointed
to `/run/secrets`. Initial managed-certificate Ingress now leaves HTTP available
until the external load balancer/certificate are programmed; the guide disables
HTTP after Active/HTTPS validation, matching Google documentation. Added offline
rendered mount/argument/Secret checks and an initial Ingress regression guard.

Executed: `validate_deployment.py` PASS (five actual offline Compose/Kustomize
checks, nine VM tests, deployment contracts); `validate_kit.py` PASS; secret scan
PASS; Bash syntax-only validation of all 18 guide blocks and AST parsing of
embedded Python PASS. Black/Prettier and diff checks PASS. Application binaries,
contracts and migrations were not changed; the preceding repair's full Java/
frontend/build and remote CI evidence remains recorded above. These checks are
not GKE runtime proof. New cluster, bucket/Ingress creation, exact account cost
quote, real GKE/Google/GCS/restore acceptance and deployment remain NOT_RUN /
DEPLOY_PENDING: this turn prepared local code and operator commands only.

## GKE build chain and VM cutover preparation (2026-10-14)

The owner explicitly requested pushing the necessary GKE build changes and
commands to stop the VM and use GKE for the main domain. Preserved the accepted
fresh-data GKE choice; the old VM databases/volumes/buckets remain retained for
rollback. No automatic VM-to-GKE data import or Terraform environment switch
was implemented. Added the complete operator sequence in GKE_CUTOVER.md and
updated the lab, handoff and README links.

Added manual **Build & deploy GKE**, chaining the existing reusable CI/image
build/scan/publication workflow into reusable reviewed GKE rollout. The new
protected environment is **cloud-gke**; VM defaults stay **cloud-lab**. Producer
outputs carry the six immutable digests and release metadata into the same
run. Deployment rejects wrong commit/ref, V6/client/digest mismatch, plaintext/
foreign-bucket/signed backup references and missing combined-build metadata.
After OIDC, it checks the configured encrypted backup object exists and has
positive size before cluster mutations. That check is not archive authenticity
or restore proof. The workflow keeps server dry-run, five migrate-only Jobs,
backend-before-Web readiness and public health. Bootstrap, operator quiesced
backup capture, DNS/cert changes and VM shutdown are explicit actions.

Scoped setup_gke_deploy.sh reuses/creates the existing deploy identity, binds
repository WIF and existing namespace RBAC, and grants Object Viewer on only the
selected backup bucket. It grants no direct Secret get/list, registry write,
VM/IAP or Terraform administration. Namespace Job create remains a strong
capability and requires protected main/environment controls. The operator guide
keeps app writes paused from backup through build/deploy, handles the existing
lab and new main certificates, verifies the actual GKE IP/TLS/login/GCS behavior
before stopping VM services/compute, and describes old-data rollback and remaining
disk/IP charges. Budget USD300 total is unchanged.

Rendered GKE Pod templates now carry the public editor-config SHA256. Changes
to origin/provider/quota configuration therefore replace Pods even if image
digests are identical. Secrets are not hashed into this public annotation.
Actual offline rendering tests prove stable templates for unchanged input and
changed templates for all six apps with unchanged images when quota changes.

Executed locally (Python 3.12.14/JDK21, no cloud credentials/actions):

- validate_deployment.py: PASS; **six actual offline Compose/Kustomize tests**,
  **nine VM rollout tests**, **six new GKE release/workflow tests**, and existing
  deployment/security/migration contracts. No skipped test substituted for a
  real-cloud gate.
- tooling/scripts/run.py quality: PASS, Black, Java imports/POM/Spotless,
  Prettier, frontend lint/type/boundaries, gateway/resolver tests and source-size
  review. Log: testing/reports/gke-cutover-quality.log. Existing source-size
  signals remain seven files/36 functions.
- actionlint **1.7.12**: PASS for all GitHub workflows (official release ZIP
  checked against its published SHA256). Bash and embedded-Python syntax checks
  for **89 guide/workflow blocks** plus the setup shell helper: PASS; those
  commands were parsed only, never executed against Google Cloud.
- validate_kit.py, secret scan, final Black/Prettier and diff checks: PASS.
  Java/application/SQL/API/native-format source
  was not changed; this turn uses scoped tooling/config tests and quality rather
  than rerunning the preceding full application acceptance as cloud proof.

Remote push CI [38585052108](https://github.com/DatTranDev/docnest/actions/runs/38585052108)
on code commit `48f31cf07c7867669db9daa3164850508d85e52a`: **PASS**, completed
2026-10-14 15:02 UTC, both Terraform preparation and full core application CI
jobs successful. Same-run image publication/deploy, actual IAM/RBAC, GKE
backup/restore, DNS/certificate propagation, main-domain functional acceptance
and VM shutdown remain PENDING/NOT_RUN until executed. This local task did not
provision paid resources, change billing, publish images or deploy/stop cloud.

## GKE as the only cloud runtime (2026-10-14)

The owner now explicitly requests removal of the old VM, superseding the
earlier retained-VM rollback plan. Removed the manual VM workflow from main;
cloud-images and cloud-deploy dispatch/default/reusable-call guards accept only
the protected cloud-gke environment. Build & deploy GKE retains same-run
immutable release binding, image scans, quiesced encrypted backup reference
validation and existence checks, migration jobs, backend-before-Web readiness
and public health gates. No application, schema or event contract changed.

GKE_CUTOVER.md now includes DNS/TLS/readiness and exact VM/disk/IP inspection
before graceful Compose shutdown and deletion of editor-lab, its single boot
disk and regional address editor-lab-web. It explicitly discards VM database
data, retains shared infrastructure/Secrets and describes storage costs that
can remain. A refresh-only plan after deletion removes stale VM state while
environment=none prevents Terraform recreating the old VM; the separate
docnest-k8s-lab cluster remains managed through gcloud/Kubernetes. Switching
this existing Terraform selector to gke would provision another editor-lab
cluster and is not part of the selected cutover. README/current cloud guides
point to GKE; the old VM guide/helpers remain historical recovery references.

Local execution:

- Deployment validation PASS: six actual offline Compose/Kustomize tests,
  eight retained legacy recovery/security tests, seven GKE release/workflow
  tests. The removed VM-workflow-presence assertion is replaced by a regression
  asserting no active VM workflow and strict cloud-gke guards/defaults.
- Repository quality PASS: Black, explicit Java imports, POM formatting,
  Prettier, frontend boundaries, strict types, ESLint, 19 actual gateway/boundary/
  lint-glob tests, source-size reporting and Maven Spotless.
- Terraform format/validate and all five mock-provider plans PASS; no Google
  resource was contacted or provisioned by these mocked plans.
- Actionlint 1.7.12 PASS (external shellcheck/pyflakes unavailable); Git Bash
  syntax validation of 34 guide Bash blocks and AST parsing of 11 embedded
  Python blocks PASS. These commands were parsed, not executed on Google.
- Contract/document validation and deliverable secret scan PASS.

Full application tests/build for this unchanged application will run in the
normal CI after the authorized push; remote CI for this commit is PENDING.
Paid GKE provisioning, image publication, IAM/environment setup, DNS/TLS,
functional acceptance, backup restore and old VM/disk/IP deletion remain
NOT_RUN/DEPLOY_PENDING. The existing total learning budget is unchanged.

Remote CI confirmation for implementation commit `68d4c713643eac0b6c88a14d4a59c5174c6400f6`:
[run #38597536054](https://github.com/DatTranDev/docnest/actions/runs/38597536054)
PASS on 2026-10-14, both application and cloud-preparation jobs successful.
Normal core application tests/audits/builds and offline deployment/Terraform
checks ran on GitHub. Manual cloud publication/deployment was not dispatched;
all real GKE, DNS, backup-restore and VM-removal gates above remain pending.

## Basic push/PR CI (2026-10-14)

At the owner's request, routine CI now runs quality, a Docker-free Maven verify with eight explicit container-backed test-class exclusions, frontend unit tests and both production/static builds. Real MySQL/Kafka/Redis tests, contract validation, dependency/secret scans, digest/deployment checks and Terraform remain in the runtime/full-acceptance modes requested by cloud builds or manual full acceptance. No tests or check implementations were deleted, and no cloud action was executed. README and the deployment-mode assertions describe this scope.

GitHub job 115971170252 failed on the packed/dense range property test's 5-second timeout after Maven completed. That one test now has a 30-second timeout, retaining the same seed, 100 cases and assertions.

Executed local validation:

- JDK 21 Maven verify with the workflow's eight exclusions: PASS; 98 tests, zero failures/errors/skips; 64 seconds with existing local caches. This is unit/architecture evidence, not real-service acceptance.
- `npm test`: PASS; 58 editor-core + 74 web tests. Targeted rerun of compact-storage after the timeout change: PASS, five tests.
- `python testing/checks/java_imports.py`, POM formatting, Black 26.5.1 check (41 files using bundled Python 3.12.14), `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run architecture`: PASS.
- Node gateway/lint-glob tests: PASS, 14 tests; frontend-boundary tests: PASS, five tests.
- `npm run build`, `npm run build:local`: PASS. Existing Vite bundling warnings remain.
- actionlint 1.7.12 for ci.yml, `ci_modes()` deployment assertions, `git diff --check`: PASS.
- Source-size report: reviewed; this change adds no production responsibilities. Existing informational oversized-source signals remain.
- Remote CI duration after this change, full Docker/browser acceptance and cloud validation: NOT_RUN; local-only scope. The new GitHub runtime has not been measured.

Initial local command attempts used unavailable Python paths, PowerShell parsed an unquoted Maven property, and the Java AST scan picked Java 17 from PATH. Corrected to bundled Python 3.12.14, quoted Maven properties and JDK 21 on PATH; final checks above follow those corrections.

## CI timeout and GKE build configuration follow-up (2026-10-15)

Read the owner-linked job 115971170252 in run 38598455560: the old e970237
commit passed Maven, then its packed/dense range property test exceeded the
5-second timeout (about 6.4 seconds). Commit 1953532 already raises only that
test's timeout to 30 seconds with its seed, 100 cases and assertions retained.
[Routine CI run #38601505135](https://github.com/DatTranDev/docnest/actions/runs/38601505135)
on that commit completed successfully; cloud-preparation was intentionally
skipped in the basic push mode, not a real cloud acceptance claim.

The later manual image build
[run #38602388601](https://github.com/DatTranDev/docnest/actions/runs/38602388601)
on the same commit passed both validate/application (including required cloud
runtime checks) and validate/cloud-preparation, then images job 115991166798
failed before authentication/build/publish: `GCP_PROJECT`, `GCP_REGION`,
`GCP_WIF_PROVIDER` and `GCP_CI_SERVICE_ACCOUNT` were all empty in cloud-gke.
This is missing GitHub environment configuration, not another timeout failure.
Added explicit public-variable GitHub CLI commands and failed-job rerun guidance
to GKE_CUTOVER.md. No environment variables, credentials or cloud resources
were changed by Codex and no image build/publish was dispatched.

Documentation Prettier, contract/document checks and Bash syntax parsing PASS.
Actual cloud-gke variable setup and successful image publication remain
PENDING until the operator executes them.

## Kafka GKE startup repair (2026-10-15)

The owner reports the fresh Singapore docnest-k8s-lab cluster RUNNING with one
Ready e2-standard-2 node, Workload Identity/buckets configured and MySQL ready.
Kafka remained unready with 250 restarts. Previous-container logs identify a
fatal LogManager KafkaException: the ext4 volume-root lost+found directory
was interpreted as an invalid topic-partition directory. They also contain
UnknownHostException for kafka. These are owner-provided live diagnostics,
not agent-executed cloud validation. The image publication run #38602388601
has since completed successfully after the operator configured cloud-gke.

Added a same-image, non-root UID1000 init container that removes only an empty
lost+found directory with rmdir. It refuses non-empty recovery directories,
files or symlinks; no recursive deletion, PVC replacement, log-directory move,
metadata formatting, password rotation or image rebuild is performed. Existing
Kafka metadata, segments, volume mount, cluster ID, SASL/ACL and probes remain.
The private Kafka Service now includes named client/controller ports 9092/9093
and publishNotReadyAddresses so controller registration and the advertised
broker endpoint are reachable before the readiness probe succeeds.

Added offline rendered endpoint/selector/target-port/bootstrap contracts;
the new topology test failed against the original manifest for missing 9093
and readiness filtering, then passed after correction. Added actual Bash
init-command filesystem tests for missing/empty recovery directories, repeat
execution, non-empty recovery files and unexpected regular files; existing
metadata/segment bytes remain unchanged in all cases. These are real local
filesystem tests, not a Kafka/Kubernetes runtime acceptance substitute.

GKE_SINGAPORE_LAB.md now captures logs before restart and supplies a narrowly
scoped Service/StatefulSet repair, synchronizes cached render and restarts only
Kafka's Pod using its existing PVC. The supplied DNS Service/namespace/policy
configuration appears consistent with the intended rules, but actual DNS
resolution is not yet verified; do not claim the DNS error is resolved.

Executed: validate_deployment.py PASS (eight Compose/Kustomize/storage-init
tests, eight legacy recovery tests, seven GKE release tests); repository
quality PASS (Black/imports/POM/Prettier/boundaries/types/ESLint, 19 gateway/
boundary/lint-glob tests and Maven Spotless); contract/document checks and
secret scan PASS. Docker-backed Kafka/Kubernetes reproduction NOT_RUN: local
Docker Desktop Linux engine pipe is unavailable. Remote CI and applying this
repair, Kafka readiness/ACL, migrations, GCS/app/browser/TLS acceptance remain
PENDING/DEPLOY_PENDING. No paid cloud action or deployment was performed.

Additional guide verification PASS: 19 Bash blocks parse with Git Bash and six
embedded Python blocks parse as AST. Executed the guide's cached-render repair
against real temporary YAML files: only Kafka Service/StatefulSet change, other
public configuration and the original volumeClaimTemplates remain identical.

## GKE infrastructure readiness and ACL command correction (2026-10-16)

The owner's latest Cloud Shell output reports Kafka, MySQL and Redis each
1/1 Running and both existing PVCs Bound. Kafka still shows eight historical
restarts; this is readiness evidence, not proof of sustained stability. DNS
resolution resumed after the operator applied the narrow allow-gke-dns-debug
egress policy permitting UDP/TCP 53 to the DNS Service and observed DNS Pod IP.
The precise networking cause remains unconfirmed. Preserve this working policy
until a durable replacement is validated; its observed DNS Pod IP is ephemeral.

The earlier guide invoked kubectl exec with redirected input but omitted -i.
Consequently a successful empty bash invocation did not prove topics/ACLs were
initialized. Both guide commands now directly execute the existing mounted
/opt/editor-kafka/kafka-init-acls.sh in the kafka container and require its final
confirmation message. Real topics/ACL initialization, five migration jobs,
application rollout and browser/TLS/GCS acceptance remain DEPLOY_PENDING.
This documentation correction requires no application image rebuild.

Executed: validate_deployment.py PASS (eight cloud preparation tests, eight
legacy recovery tests and seven GKE release tests); all 19 guide Bash blocks
parse with Git Bash; documentation Prettier and git diff checks PASS. Live ACL
initialization and migrations NOT_RUN locally: no connected GKE operator session.

## GKE service environment collision repair (2026-10-16)

The owner confirmed Kafka's final topics/ACL success marker and supplied all five
migration Pods Completed. Live capacity output shows one e2-standard-2 exhausted:
1906m CPU requested (98%), 1996m used (103%), Payment/Processing Pending. The
owner subsequently reports two Ready nodes and Payment/Collaboration 1/1;
Processing was Running but unready. This is operator-reported cloud evidence.
Two nodes incur an additional node's compute/boot disk/IP; the guide now clearly
separates this observed capacity from its original one-node cost assumptions.

Identity and Document previous-container logs identify a separate deterministic
startup failure: spring.data.redis.port cannot parse the Service-injected
REDIS_PORT tcp:// URL as an integer. Set enableServiceLinks=false on all six
application Deployment Pod templates. Explicit ConfigMap/Secret configuration,
DNS discovery, image digests and normal-startup Flyway disabling remain intact;
no migration or infrastructure template changes are needed.

A new real-render contract checks the Identity/Document numeric Redis fallback
against the actual Redis Service port, explicit Redis DNS/config wiring and
disabled Service environment injection on six rendered application templates.
It failed on all six original templates before the fix and passes after it.
The guide supplies a narrow live patch for the two failed Deployments and updates
only enableServiceLinks in cached application/backends/web render files to avoid
reintroducing the fault. No image rebuild or paid cloud action was performed.
Live corrected startup, full rollout and browser/TLS/GCS acceptance remain
DEPLOY_PENDING until the operator applies and verifies the repair.

Executed: validate_deployment.py PASS (nine actual Compose/Kustomize/render/init
contracts, eight legacy recovery and seven GKE release checks); repository
quality PASS (Black/imports/POM/Prettier/boundaries/types/ESLint, 19 Node HTTP/
boundary/glob contracts and Maven Spotless). Contract validation and secret scan
PASS. All 20 guide Bash blocks and seven embedded Python blocks parse. Executed
the guide's cache repair twice on real rendered temporary files: only application
Service links flags change; bootstrap/infrastructure/migrations remain byte
identical. Live Kubernetes regression NOT_RUN locally: kubectl has no current
context; owner-provided rollout verification is still required.

## GKE readiness, VM retirement and Terraform quota routing (2026-10-16)

The owner reports all five backends and Web Ready after the Service links fix;
five migration Pods are Completed. The public GKE IP is 8.232.180.77 and the
lab ManagedCertificate editor-tls was still Provisioning at the last supplied
output. Agent read-only checks confirmed public A DNS points to that IP, no AAAA
answer, and the HTTP load balancer healthz returns 200 with status UP. HTTPS,
login/GCS/save/export and main-domain cutover acceptance remain DEPLOY_PENDING.

The owner explicitly requested immediate old VM/disk/IP deletion to stop their
charges, superseding the guide's wait-until-main-domain-acceptance ordering.
Supplied commands target only editor-lab, its verified boot disk, and regional
editor-lab-web IP 34.87.46.187, preserving shared/GKE resources. No destructive
cloud action was executed by the agent. Full remote deletion/retained backup
inventory is not yet verified. The subsequent refresh-only plan reports the old
VM IP output removed but fails reading Budget with ADC quota project missing
and an SDK consumer-project SERVICE_DISABLED error; no successful state apply
has been reported.

Configure the Google provider with billing_project=var.project_id and
user_project_override=true so ADC-authenticated client-based Budget API calls
send the explicit lab quota project. The retirement guide also supplies the
equivalent environment variables for an existing checkout before regenerating
the refresh-only plan. Existing cumulative budget dates, the operator's local
VND budget edits, Secrets, infrastructure and resource state are not reset.
Live authenticated refresh/state apply remains PENDING until operator execution.

Executed: Terraform fmt/validate PASS and all five mocked-provider tests PASS;
these check configuration/schema and plan contracts, not authenticated API quota
routing. Documentation Prettier, contract validation and git diff checks PASS;
18 cutover Bash blocks and six embedded Python blocks parse. Live Budget API
refresh NOT_RUN locally because no connected operator credentials/context are
configured; no billing API, IAM or paid-resource mutation was performed.

## Automatic encrypted backup for one-button GKE updates (2026-10-16)

The owner requests a single Build & deploy GKE action without repeating manual
bootstrap/backup commands. The main dispatcher now has no inputs and first checks
the one-time configuration, then builds/scans six images before entering the
shared deployment lock. The reusable deploy job validates release/dry-runs before
pausing writes, switches to a dedicated backup identity, captures a fresh encrypted
backup, restores the narrower deploy identity, verifies the uploaded object, runs
five migration jobs and rolls out backend readers before Web/public HTTPS health.
Advanced reviewed-digest deployment retains its mandatory manual backup reference.

Automatic capture reuses the existing five-database/GCS-generation/JWT-version
integrity helper, records running digests, stops Web before service writers and
keeps SQL/Kafka/Redis running. Deployment UID/template/config/replica/maintenance
ownership checks fence pause/recovery. A failed read-only capture/encrypt/upload
attempts to resume only unchanged owned apps; concurrent changes block recovery.
Successful backup keeps apps paused until rollout. There is no automatic SQL/DDL
rollback after migration starts. Plaintext/key/archive material stays in a private
temporary directory and is cleaned; only age ciphertext is uploaded with generation
match 0. Artifacts contain only release/backup references/public health evidence.

Added scoped backup IAM/RBAC setup and a one-time Cloud Shell setup helper that
requires working HTTPS, reuses current public ConfigMap values, configures the
separate bucket and GitHub Variables, and creates/reuses a local age private key
without sending it to GitHub. A pre-existing mismatched recipient is not rotated.
New backup bucket lifecycle is 14 days; node/resources/budget are not changed.
Deploy RBAC adds named Deployment list for rollout watch without Secret access;
backup identity alone has named JWT get and MySQL-only exec. WIF-generated
credential files are excluded from Git/build contexts. Only operator commands
configure live IAM/buckets; no such cloud action has been executed locally.

Added nine state-machine/command tests for pause ordering, stable running images, duplicate/
unhealthy maintenance rejection, recipient failure, partial-pause recovery,
capture/encryption/upload failures and concurrent config/template/UID/owner changes.
These use explicit fixtures, not real GKE acceptance. Actual age 1.3.2 archive
encryption/decryption preserves fixture SQL/key/object bytes and rejects wrong keys
and tampering; binary verified against its official GitHub release asset SHA256.
CI cloud-preparation also runs this offline real-crypto check without credentials.
Source documentation now describes automatic and advanced/manual paths separately.

Read-only HTTPS health at the lab domain now returns 200 with certificate
verification enabled. Agent has not deployed these changes or run a real GKE
automatic backup/restore, IAM grant or GitHub workflow. One-time setup and the
first full automatic update/restore drill remain DEPLOY_PENDING.

Executed: repository quality PASS (Black/imports/POM/Prettier/boundaries/types/
ESLint, 19 real Node HTTP/boundary/glob tests, source-size review and Maven
Spotless); deployment preparation PASS (nine Compose/Kustomize contracts, eight
legacy recovery, nine GKE release/IAM/workflow checks and nine automatic-backup
unit/command checks). Real age archive round trip, wrong-key rejection and tamper
rejection PASS. Actionlint, contracts, kit/document links and secret scan PASS.
Three setup scripts and 39 guide Bash blocks parse; both setup Python blocks
parse, and the actual public-config extractor accepts optional empty values and
rejects newline injection. Optional empty Stripe Variables are removed rather
than invoking an interactive gh value prompt. Local Docker-backed/cloud runtime
acceptance NOT_RUN: Docker Desktop Linux engine pipe is unavailable and no GKE
operator credentials/context are connected. No image publication, deployment,
IAM/bucket creation, SQL restore or paid-resource operation was executed locally.

## CI/CD build optimization — 2026-10-16

Reviewed all four Actions workflows, Dockerfiles and GKE release/backup sequencing. Source-level bottlenecks: serial Java/frontend verification, five repeated cloud Maven builds, npm installation invalidated by source edits, and disposable cloud build layers. No remote timing baseline was retrieved; no measured speedup is claimed.

Basic Java verification now runs alongside frontend validation. The existing `application` check aggregates all required results and rejects unexpected skips/failures/cancellations. Cloud images share one five-service Maven build; each nonroot service image contains only its owning jar. Local Compose retains the selected-service default build. Web dependency installation precedes source copies. BuildKit layers, Next compiler output and pip downloads are cached. Cloud runtime OS layers refresh each run. Exact-image scans, protected immutable releases, encrypted backups, migrations and backend-before-Web rollout remain required. Deployment maintenance downtime has not been measured or shortened by bypassing gates.

Validation executed:

- `.tools/actionlint/1.7.12/actionlint.exe -shellcheck= .github/workflows/ci.yml .github/workflows/cloud-images.yml .github/workflows/cloud-deploy.yml .github/workflows/gke-build-deploy.yml`: PASS; ShellCheck unavailable, workflow/expression validation ran.
- Actual aggregate shell executed through Git Bash for all 128 combinations of basic/runtime mode and success/failure/cancelled/skipped dependencies: PASS.
- `python testing/checks/validate_deployment.py`: PASS, offline rendering and CI/release/backup policy assertions. `python testing/checks/gke_release_check.py` and `python testing/checks/gke_auto_backup_check.py`: PASS, nine tests each.
- `python testing/checks/validate_contracts.py`, `python testing/checks/validate_kit.py`, `python testing/checks/java_imports.py`: PASS.
- `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run architecture`: PASS. `node --test testing/checks/next-lint-glob.test.mjs frontend/web/server/gateway.test.mjs`: PASS, 14 tests.
- `npm test`: PASS, 58 editor-core/74 web tests. `npm run build` and `npm run build:local`: PASS; existing static Vite directive/chunk warnings remain.
- With JDK 21 selected, `./mvnw.cmd -B -ntp spotless:check`: PASS. `./mvnw.cmd -B -ntp verify '-Dtest=!IdentityMySqlTest,!LoginRateLimiterRedisTest,!IdentityBootstrapTest,!DocumentIntegrationTest,!ProcessingMySqlTest,!KafkaSqlFlowTest,!JdbcRoomDaoTest,!JdbcPaymentDaoTest' '-Dsurefire.failIfNoSpecifiedTests=false'`: PASS, matching basic CI's explicit Docker-test exclusions. Initial unquoted Surefire property failed due to PowerShell parsing; quoted rerun passed.
- `node testing/checks/source-sizes.mjs`: PASS after selecting JDK 21 on PATH; initial default-Java invocation failed. Seven file/36 function signals cover existing Java/frontend responsibilities; this task changes no Java/TypeScript implementation and introduces no mechanical splitting.
- `node testing/checks/local-tools-browser.cjs`: PASS on compiled static output, including zero API/remote requests.

NOT_RUN: full real-service Maven verification, container builds/cache cold-and-warm measurements, exact-image scans and authenticated application/browser acceptance require the unavailable Docker Desktop Linux engine. Black 26.5.1 refuses installed Python 3.12.5; Black and combined `run.py quality/test` remain NOT_RUN pending Python 3.12.6+, without bypassing AST safety. Remote Actions, image publication and GKE dry-run/backup/restore/deployment/timing remain NOT_RUN / DEPLOY_PENDING. No paid resources, registry pushes or deployments occurred. Existing budget gates and measured performance misses remain unchanged.

## Selective CI/CD proposal implementation — 2026-10-16

Implemented the owner's supplied DOCSNEST_CICD_IMPROVEMENT_PROPOSAL.md as ADR036, preserving the earlier workspace optimizations. The operator procedure is docs/CICD_SELECTIVE_RELEASES.md. Local implementation is separate from live rollout/restore acceptance; no cloud provisioning, IAM changes, registry push or deployment was executed.

Changes:

- Dependency-aware Git impact resolves PR merge-base, push predecessor or approved deployed commit; handles renames/deletions, conservative unknown/shared inputs and immutable migration rejection. Basic CI verifies selected Maven modules with dependencies, selects frontend tests/builds, always runs global quality/contracts/secrets/release policy, and preserves the aggregate `application` required check. Comprehensive acceptance also has a weekly/manual workflow.
- Selected cloud images share one scoped Maven reactor. Secret/OS scans require the exact selected image set and matching image IDs; publication rechecks those IDs. V2 per-image provenance records source commit/run, immutable registry digest and scan-evidence hash. Partial build manifests merge into full approved environment state, retaining unaffected provenance. Build/deploy stage durations and bounded results are recorded.
- A separate routine workflow verifies protected acceptance/restore evidence, a reviewed recent encrypted recovery object and all six actual live images, then renders/applies only selected Deployments and migration owners. New Jobs are release-scoped, never globally deleted. Mixed-version migration compatibility requires explicit review; coordinated native/event changes retain the full maintenance path. Full/routine mutations share the same environment lock.
- Routine never invokes the quiescing backup helper. The existing tested quiesced backup remains on the explicitly named maintenance path. Routine stays disabled until actual rollout/capacity/worker and isolated-restore evidence is reviewed. Independent online backup/PITR scheduling, infrastructure HA and metric-driven canaries remain operator work; no online dump is mislabeled as application-consistent recovery.
- Application generator and regenerated manifests retain one desired replica, use maxSurge1/maxUnavailable0, ten-second minimum readiness/preStop, graceful shutdown and 160-second grace. Gateway drain covers its 130-second request bound. Optional ingress draining is 150 seconds and needs operator application. Effective public configuration/key references/checksums are service-specific. Routine observes readiness, waits for old Pods to drain, and checks unrelated template fingerprints/Pod UIDs. These sampled checks do not prove continuous authenticated traffic or zero downtime.
- Source audit covers outbox leases, inbox/saga fencing, retention generation deletes, Processing leases/completion and Collaboration SQL/checkpoint idempotency. No permanent second replicas or business/SQL/native/API changes were introduced. Collaboration uses HTTP polling; WebSocket upgrade rejection remains intentional.

Executed local validation:

- `python -X utf8 tooling/scripts/run.py quality` with bundled Python3.12.14, pinned tools under `.tools/python-quality`, and JDK21: PASS (Black, imports/POM, Prettier, architecture/types/ESLint, 19 Node HTTP/boundary/glob checks, AST size review and Spotless). This resolves the previous checkpoint's Python3.12.5 Black blocker. Seven file/36 function size signals remain existing editor/domain responsibilities; no mechanical splitting was introduced.
- `python testing/checks/selective_release_check.py`: PASS, 16 tests, including configuration-dependency coverage, real Git merge/rename/delete/immutable-migration cases, exact-selection scan rejection, per-service config, baseline/live safety and 259 actual aggregate-shell status cases. One resource-stressed attempt failed with Git native allocation error; the serial rerun passed.
- `python testing/checks/validate_deployment.py`: PASS, including ten actual Compose/Kustomize preparation contracts, eight legacy recovery checks, nine GKE release checks and eleven backup orchestration checks. Generator output reproduces all application/migration objects; selective rendering emits only Document and its applicable unique migration Job. `actionlint -shellcheck=`: PASS for all six workflows (ShellCheck unavailable).
- Contracts, kit/document links and source secret scan: PASS. Actual age encryption/decryption, wrong-key and tamper rejection: PASS using `.tools/age/1.3.2/age` (an initial parent-directory invocation could not find the executable; corrected command passed).
- `npm test`: PASS, 58 core/74 web tests. Production and standalone builds: PASS, retaining existing static-build warnings. Production Worker check: PASS with eight actual Workers and stable source hashes. Standalone browser check: PASS, zero API/remote requests. Gateway shutdown test keeps an actual response lasting over 30 seconds intact during shutdown.
- Selected JDK21 Maven reactor `-pl backend/document-service -am verify` with basic-CI Docker-test exclusions: PASS, 17 common and19 Document tests; no failures/errors/skips among executed tests.
- Docker became available during this turn. Real Buildx Document-only build compiled/packaged only common+Document; actual musl Web image build passed. Both images loaded locally. Their optional local cache exports failed because D: ran out of space; this is not a successful cache-export benchmark. App containers were not restarted. Image IDs: Document `sha256:9f949596faebdef624340e3ece359d067c1b62ea1f391ad037c44fd423abeaa1`; Web `sha256:36a1e1743ce3cc0f2f1cf03d0bd198ea103dca2a9f2cdea11812fffb78a7baf0`.
- Exact selected secret/OS image scans: PASS for the High/Critical publication gate and matching image IDs. Web had no OS findings; Document retained55 Medium/4 Low findings, no High/Critical. Evidence is under `C:/Users/DAT/AppData/Local/Temp/docsnest-cicd-verify-iz9r534i/testing/reports/` because D: was full; these are local image IDs, not published release digests.

Resource limitations: initial full Maven verification reached actual MySQL/Redis/Kafka tests but the Processing JVM failed native-memory allocation. A source snapshot on C: was used to avoid D: output exhaustion; its first full run also hit JVM resource limits. The temporary Buildx builder was stopped. Cleanup of the newly created `.tools/cicd-build-cache` directory was rejected by automatic approval review with only `blocked by policy`; it remains on disk, and no alternative deletion method was attempted. No user application volumes/containers were removed or restarted. Full-verification follow-up is recorded below.

Remote Actions, registry publication, GKE server dry-run, actual target/unrelated Pod acceptance, load-balancer traffic/drain, mixed-Pod worker failure/rebalance tests, online backup/PITR and isolated cloud restore remain NOT_RUN / DEPLOY_PENDING. The protected routine enable flag and evidence Variables were not set. Existing USD300 budget/cloud gates and measured application performance misses remain unchanged. No measured CI speedup or zero-downtime claim is made.

Final local follow-up for the selective-release implementation:

- Full `mvnw.cmd -B -ntp verify` on the C: source snapshot: PASS,141 tests, zero failures/errors/skips, including real MySQL/Kafka/Redis/Testcontainers and architecture checks. It ran serially with parent `MAVEN_OPTS=-Xms32m -Xmx128m -XX:ActiveProcessorCount=2 -XX:ReservedCodeCacheSize=64m`; test JVM limits and all tests remained unchanged. Log: `C:/Users/DAT/AppData/Local/Temp/docsnest-cicd-verify-iz9r534i/testing/reports/raw/cicd-maven-serial.log`. Earlier native-memory failures remain recorded above.
- Buildx cache export to C: PASS for Document and Web. Import into a separate fresh `docsnest-cicd-cache-review` builder: PASS; Maven packaging, npm installation and Next build restored as CACHED, preserving both scanned image IDs. Logs: `docker-document-cache.log`, `docker-web-cache.log`, `docker-document-cache-import.log`, `docker-web-cache-import.log` in the same raw evidence directory. This proves a local export/import round trip, not a remote CI duration improvement.
- Exact Alpine/musl image runtime: PASS,12 real gateway HTTP/process tests mounted read-only into the built Web image under its nonroot user/512MiB limit, including the long-response drain. Log: `gateway-musl.log` in the same raw evidence directory.
- Quiesced maintenance backup generalization: PASS,11 orchestration/command tests. Recovery preserves each captured replica count, including heterogeneous2..7-count fixtures, and rejects a concurrent scale operation; actual resource-version/UID-fenced patch generation is checked. Full maintenance manifests now preserve live desired counts. Real age crypto still PASS. These unit/command tests do not establish actual multi-replica GKE backup/restore safety.
- All nine pre-existing Compose application/infrastructure containers remained healthy throughout; no application restart or data-volume cleanup was performed. Both temporary Buildx builders are stopped. D: remains nearly full and the rejected task-cache cleanup remains unresolved; C: verification artifacts/caches are retained for review. Remote/cloud acceptance and routine enablement remain DEPLOY_PENDING as described above.

## One-button rolling deployment — 2026-10-17

Owner explicitly replaced the downtime/multiple-dispatch procedure with one Build & deploy button. ADR037 supersedes ADR036's maintenance fallback and manually supplied acceptance/baseline/backup inputs. Changes are local until the associated PR is merged; no cloud rollout, IAM update, live resource/environment deletion or image publication was performed.

- Only the protected main Build & deploy workflow dispatch releases apps. Internal cloud-images retains broad real-service validation, selected Maven/BuildKit builds, exact-image scans and immutable publication. CI push/PR/manual full checks remain. Deleted cloud-deploy, gke-selective-deploy and scheduled-acceptance wrappers; removed quiescing GKE backup/release-input automation, backup identity setup/RBAC and obsolete VM release/setup executables and their retired tests. Six app Deployments and owning migration templates are all required and remain. Historical infrastructure/backup inspection references remain; repository deletion does not remove live cloud resources or recovery data/keys.
- Automatic paginated repository Actions artifact discovery selects only known manual main releases with successful PASS state and matching source commit. It verifies full V2 registry/provenance and ancestry. Missing/expired evidence forces a full six-image same-run scanned adoption; API/archive errors do not silently fall back. Actual healthy/stable live images must match approved state. Interrupted mutations block future runs and same-run retries; pre-mutation failures can retry. One concurrency lock covers discovery through rollout.
- Removed JSON/backup/service/compatibility workflow inputs and routine-enable/evidence Variables. Config/proxy consumer scope widens automatically; Google client changes require a Web rebuild. SQL resources and schema mirrors must match versioned reviewed normalized hashes in infra/k8s/rolling-migrations.json. Unreviewed SQL and coordinated protocol/native changes fail before publication, with no downtime fallback. First adoption runs the reviewed owning migration histories; subsequent releases use only changed owners and unique Jobs. Backup/restore now operates independently and is not certified by deployment.
- The rolling executor preserves positive desired replica counts, maxSurge1/maxUnavailable0, dry-run-before-mutation, backend-before-Web order, all-service endpoint/public readiness observation, graceful drain and unchanged unrelated identities. Fixed a real artifact round-trip issue: before-Pod records loaded from JSON were arrays while newly sampled records were tuples, falsely reporting unrelated restarts. Evidence now uses JSON-stable arrays, with a regression check. No-op releases avoid apply/restart and record current PASS state. Summaries report selected services.
- Updated README, one-click/runbook/cutover/bootstrap guidance and one-time setup. The setup no longer provisions a backup bucket or grants backup/Secret/Pod-exec access. Existing protected environment configuration remains required; older live deploy RBAC needs the operator's one-time update for Pod/EndpointSlice observation. No automatic privilege escalation is added.

Executed validation:

- Bundled Python3.12.14 with pinned .tools/python-quality and JDK21: tooling/scripts/run.py quality PASS (Black, Java imports/POM, Prettier, boundaries, strict types, ESLint, 19 real Node HTTP/glob/boundary tests, source-size review and Spotless). Seven file/36 function size signals remain existing Java/frontend responsibilities.
- testing/checks/gke_release_check.py PASS: 15 offline orchestration/real local HTTP transport cases covering trusted baseline filtering, run/artifact pagination, missing/expired/malformed state, failed/PENDING/retry handling, bounded archives/duplicate entries, signed redirect header isolation, config/no-op/client rotation, full scanned adoption, migration review and Pod evidence serialization. These are not GKE traffic/restore acceptance tests.
- testing/checks/selective_release_check.py PASS: 14 tests, including real Git history/rename/delete/immutable-migration checks, selected image provenance/scanner scope, generator reproducibility, config dependencies/live safety and 259 actual Bash aggregate status cases.
- testing/checks/validate_deployment.py PASS: actual local Compose/Kustomize rendering, ten preparation contracts, rolling workflow/RBAC/scoped migration assertions and release tests. Three workflows pass actionlint1.7.12 with -shellcheck=; ShellCheck unavailable. Both active setup scripts pass Git Bash -n. Contracts, kit/document links and source secret scan PASS. git diff --check PASS.

NOT_RUN / DEPLOY_PENDING: new workflow execution on GitHub, registry image publication, GKE RBAC/server dry-run/rollout, real surge scheduling/NEG drain and continuous authenticated traffic, worker mixed-Pod/rebalance/lease failure acceptance, online backups/PITR and isolated restore. No zero-downtime guarantee or measured build speedup is claimed. Service Java/frontend sources, schemas and Dockerfiles are unchanged in this follow-up, so full Maven integration/frontend production image rebuilds were not repeated; earlier execution evidence above remains attributed to the earlier revision. USD300 total budget and existing performance misses remain unchanged.

## Release resilience follow-up — 2026-10-17

Implementation is on `codex/release-resilience`. No cloud image publication, deployment, provisioning, IAM/retention change or replica increase was performed in this local task. USD300 budget is preserved. Earlier cloud-NOT_RUN statements are superseded only for the completed baseline: Build & deploy38937866068 attempt2 succeeded at2026-10-16T17:58:26Z (Oct17 00:58 Vietnam), commit5b6d0597a42a32b424b8c2602524f82bbdf1edd2. All six apps became ready;72 readiness samples had no failures/minimum one endpoint per service over505.53s. That full six-image adoption did not prove Document-only deployment or authenticated uninterrupted traffic. Verified origin was the k8s subdomain; main-domain cutover is not inferred.

Implemented: mandatory full promotion acceptance; verified-JAR fixture packaging; short same-commit/no-image acceptance reuse; authenticated and long-transfer rollout checks with scope evidence; coherent Web drain budgets/live BackendConfig preflight; fenced image-only recovery/read-only reconciliation; encrypted online five-database snapshots/binlogs and isolated recovery; independent runner/timer/least-privilege templates; provenance-chain evidence retention; private Prometheus/13 tested alert rules; optional gated availability overlay. API/events/native format/applied migrations are unchanged. Operational details: RELEASE_RESILIENCE.md and SECURITY_OS_TRIAGE.md. Prepared runner, bucket and monitoring templates are not installed services.

Executed verification:

- Latest full JDK21 Maven verify PASS150 tests, zero failures/errors/skips, including real MySQL/Kafka/Redis and architecture checks;5m51s, finished10:06:07 Vietnam. Log `.tools/remaining-maven-metrics.log`. Actual Document HTTP assertions now require private Prometheus, standard HTTP histogram buckets and outbox gauges. They cover the discovered eager MeterRegistry bug: Document/Processing Kafka hooks now resolve the registry lazily through ObjectProvider.
- Current repository quality PASS (Black, Java imports/POM, Prettier, strict TypeScript, ESLint/boundaries, actual Node gateway/glob tests, source-size review, Spotless), finished13:34; `.tools/remaining-quality-complete.log`. Resilience PASS14, GKE orchestration PASS15, selective-release PASS14 including259 actual Bash aggregate cases. Three workflows pass actionlint1.7.12; ShellCheck unavailable. Actual promtool3.15.0 verifies13 rules and alert behavior. Contracts/kit links/source secrets and deployment rendering/contracts passed.
- Frontend unit tests PASS58 core/74 web; production/standalone builds PASS. On the prior pre-metrics-fix image stack: migration-only, smoke, billing saga, seven browser suites, Worker and111.42s slow authenticated traffic passed. Workspace failed outdated folder-path/Trash-layout selectors; corrected real browser rerun PASS for previews/save, sort/search, Move/Restore, viewer ACL and bilingual desktop/mobile layouts. Eight browser suites individually passed; the original aggregate command remains FAIL.
- Complete LOCAL restore reached preserved SQL/key/native bytes, login/save/export/subscription checks but failed its final histogram/outbox assertion. Actual private scrapes exposed the registry initialization bug; the corrected Java regression passes. Final rebuilt-image application recovery remains pending Docker/CI. The restore checker now requires histograms from all five backends. The local full runner includes actual online SQL/PITR as well as full LOCAL recovery.
- Actual encrypted SQL/PITR drills PASS: five owners, concurrent DML/DDL fencing, post-snapshot cross-database replay, wrong-source and ciphertext tamper rejection. Latest SQL-only drill112.52s is not application RTO. An earlier actual old/new Document-image compatibility check passed candidate schemas; event compatibility was deliberately unverified. Final rebuilt-image compatibility remains pending.
- Earlier exact local images passed High/Critical and first-party secret/nonroot gates. Each Java image retained53 Medium/four Low findings (46 CVEs; zero available fixes in that database); Web had none. Package refresh fixed curl/libcurl High and freetype/libpng Medium findings without suppressions/risk exceptions. Those IDs predate the final Java fix and do not certify replacement images. Dependency scan PASS210 Maven runtime packages, zero advisories/unresolved; npm audit PASS zero vulnerabilities.

Retained failures/environment limitations: the existing user stack had accumulated smoke quota and configured Stripe; acceptance now uses owned random fresh projects and actual quota/rate-limit rules. Old local containers were temporarily stopped for RAM; only owned disposable test volumes were removed. Docker was restarted after an HTTP500 engine failure. At continuation13:32 it was stopped and failed startup on the old zero-byte dockerInference reparse socket. Rename failed; automatic approval review rejected socket cleanup with `blocked by policy`. No alternate deletion was attempted. User data/volumes remain intact; old containers cannot be restarted until Docker is repaired. Final rebuilt-image full acceptance and scans remain NOT_RUN locally; remote CI results must be recorded after execution.

Read-only GKE capacity assessment:2 ready nodes,3.86 allocatable CPU/12051.25MiB; other requests2.464 CPU/3661.72MiB; proposed apps0.9 CPU/1536MiB; conservative app peak2.4 CPU/4096MiB. The concurrent-termination/surge CPU bound does not fit. This is not scheduler/load simulation or resize approval. Capacity/surge and USD300 cost review remain PENDING.

DEPLOY_PENDING live gates: synthetic account Secrets and BackendConfig/read Role update; actual Document-only/config/common/no-op proofs; GKE long/authenticated/collaboration/worker overlap; scheduled encrypted GCS/PITR and isolated generation/key/Kafka/provider recovery with measured application RPO/RTO; alert delivery/evidence retrieval; approved capacity/cost and actual HA failure drills. LOCAL/SQL checks do not close these gates. No zero-downtime, HA or measured CI speedup is claimed. Existing application performance misses remain visible.

CI follow-up: basic PR validation39010703652 passed. Full validation39010713760 passed quality, real-service Maven/frontend tests, dependency scans, production/static builds, deployment contracts, Linux MySQL bootstrap, verified-image stack startup, migration-only, smoke, billing saga and seven browser suites. Workspace failed its sort-order assertion; later recovery steps were correctly skipped. Investigation found WorkspaceLibrary always sorted folders ascending while Name/descending was selected. The UI now applies the requested Name direction; browser coverage requires four known folders and waits for the actual reversed DOM rather than allowing empty arrays to pass during loading. Local strict TypeScript,58+74 frontend tests, ESLint, import boundaries and production build pass after this fix; final Linux browser/recovery rerun is pending. This failure is retained and is not treated as successful full acceptance.

Full validation39011962510 on d3cadfb passed all eight browser suites after the real folder-sort fix, slow authenticated transfer, Worker checks and the real SQL/PITR drill (75.54s). Isolated application restore verified original key/native bytes and subscription/login, and its first save/export cycle passed, but a later reopen returned502. Source traffic during capture passed103 requests/zero errors; restored traffic recorded59 requests/one502. The full gate remained FAIL. Added bounded pre-cleanup container restart/OOM and gateway-code diagnostics with privacy regression coverage (15 resilience tests now pass). Root cause and the final rebuilt-image recovery gate remain unresolved until another actual run; the502 is not suppressed or retried away.

Final implementation verification: full CI [39013681219](https://github.com/DatTranDev/docnest/actions/runs/39013681219) on e1256345fd6f39d0f8ca79a00c27e3d7c17340b5 completed SUCCESS, including the required aggregate check. Basic PR CI39013658809 also passed. This closes the current implementation's Linux full-acceptance/recovery gate; it does not close GKE/GCS/provider or final published-image scan gates. The subsequent checkpoint-only commit changes no implementation.

- All eight real browser suites PASS, including corrected folder Name/descending order with a nonempty asynchronous assertion. Full quality, real-service Maven/frontend verification, dependency/security policy checks, production/static builds, deployment contracts, Linux MySQL bootstrap, migrate-only, smoke, billing saga and Worker checks PASS.
- Authenticated source/slow transfer PASS214 requests, zero5xx/429/transport failures; ordinary-request p95=18.32ms/p99=49.55ms, three intentional slow transfers, longest64.225s, two committed versions and one verified export. These are synthetic LOCAL fixture measurements, not GKE latency or rollout overlap.
- Actual encrypted SQL/PITR PASS76.09s, including concurrent DML/DDL fencing, post-snapshot cross-database replay and wrong-source/tamper rejection. This is SQL-only timing.
- Complete isolated LOCAL application recovery PASS208.96s after capture: five restored databases, original signing key/JWKS/native bytes, login/save/export/subscription reads and private HTTP histograms on all five backends. Restored traffic PASS75 requests/zero failures, two commits/one export, ordinary p95=301.29ms/p99=1335.59ms. The pre-traffic snapshot collected nine healthy containers, zero restarts/OOM events and16766414848 Docker memory bytes. That snapshot is not continuous infrastructure telemetry. GCS restore, historical Kafka replay, provider reconciliation and production RPO/RTO remain NOT_RUN/NOT_MEASURED.

The earlier single restored-reopen502 did not reproduce in this diagnostic run. No application change, retry or relaxed HTTP gate was added between those two runs; its root cause remains unproven. Both failed and successful runs remain recorded. Future failures retain allowlisted restart/OOM/gateway diagnostics before cleanup. Successful acceptance proves the exercised scenario only, not absence of intermittent failures or production zero downtime.

Delivered as draft [PR6](https://github.com/DatTranDev/docnest/pull/6). Cloud installation/acceptance and existing performance/capacity/cost gates remain as listed above. Current final image OS/secret publication scans and a new exact-image mixed-version proof remain pending the protected publication/compatibility workflow; previous scanned IDs are not reused as proof. Local Docker's stale socket/approval-review blocker is unchanged, so the user's preserved old local containers have not been restarted. No cloud resources or IAM were changed.

## Authorized cloud continuation — 2026-10-17

Owner approved merge and continuation on existing cloud infrastructure. PR6 merged as `f51b01dc2332e1d23cf012171b6664ffffb2fe92` after fresh required checks on81741c1 passed. Two dedicated synthetic accounts were registered and login-verified through the public HTTPS application under its existing MAX_USERS100 quota. Four ROLLOUT_* values were stored as protected cloud-gke environment Secrets; credentials are excluded from reports and repository history. The existing editor-web BackendConfig now uses timeout130s/drain150s, and the existing editor-deployer Role gained only GET on that named BackendConfig. All six applications were ready at one replica before setup. No node, replica, paid resource, billing or retention change was made.

Build & deploy [39022802338](https://github.com/DatTranDev/docnest/actions/runs/39022802338), main f51b01d, was dispatched once. Plan and cloud preparation passed; full acceptance/build/publication/rollout are IN_PROGRESS, not yet accepted. The existing two e2-standard-2 GKE nodes are the only Compute Engine instances found in the project; no independent backup runner was identified. Scheduled backup/monitoring, isolated GCS recovery, capacity/cost and remaining overlap gates stay PENDING.

Preparing a genuine Document-owned follow-up for independent release proof: tag its private meters with the bounded application identity, with a real HTTP integration assertion over nonempty histogram samples. It changes no public API/events/native format/schema or other service implementation. Scoped JDK21 Spotless apply, YAML Prettier and git diff check PASS. New real-service integration verification is NOT_RUN locally because Docker remains unavailable; remote CI/full promotion must verify it before release. This source preparation is not evidence of a Document-only cloud deployment or no-op release.

Continuation supersedes the local Docker blocker: the existing desktop-linux engine became available without another socket cleanup. Full root JDK21 Maven verify on the Document metrics change PASS150 tests, zero failures/errors/skips,4m22s, finished17:00:33 Vietnam; `.tools/document-metric-maven.log`. The actual Document HTTP integration test passes the application label assertion. After verification, all nine original text-editor containers were started by their existing names, with no recreation, image replacement or volume deletion; all nine became healthy. The earlier rejected socket operation was not retried. PR7 basic push/PR checks passed on fabb982; the following checkpoint/estimate additions change documentation only.

Owner confirmed no independent Linux runner exists and permitted adding backup infrastructure. Prefer a single independent runner over another application cluster. `docs/benchmarks/backup-cost-estimate.json` records fresh Google Cloud Billing Catalog Singapore SKUs: e2-medium about USD30.17/month at730h,30GiB standard disk1.32 and IPv4 about3.65, fixed subtotal35.14 before GCS/operations/network/logs/tax. Ten GiB Standard GCS would add0.20/month; USD40 is a planning allowance, not a hard billing cap. Actual remaining USD300 total credit/budget is unverified; no backup VM/bucket, retention policy or new IAM was created. Runner bootstrap, verified MySQL TLS/connectivity, offline-key custody and full cloud recovery/monitoring remain PENDING. This estimate does not certify recovery or authorize unbounded spend.

## Promotion fixture pacing correction — 2026-10-17

PR6 merged as f51b01d after green checks. Build & deploy [39022802338](https://github.com/DatTranDev/docnest/actions/runs/39022802338) then failed its structure-browser login with HTTP429. Quality, real-service Maven/frontend verification, production builds, migrate-only, smoke, billing saga and the preceding browser suites had passed. Exact image publication and deployment were skipped; no application rollout occurred. The failure is retained. The one-time dedicated synthetic Secrets, existing editor-web timeout130s/drain150s and named BackendConfig GET Role were configured before that run; these setup changes are not a completed rollout.

The actual Identity limiter allows ten login attempts per address per60s. The suites share the ephemeral stack's address; only workspace had read-only fixture-budget pacing. Faster preceding suites could exhaust the same window before structure. CI and the isolated full runner now wait for budget before each authenticated browser suite, reserving the conservative four-attempt fixture bound. The existing helper reads Redis using EVAL_RO and waits for natural expiry. It never deletes/reset counters, disables/increases the production limit, retries failed browser logins or relaxes acceptance. Local-tools remains unauthenticated.

Executed: pinned Black and Prettier, actionlint1.7.12 (-shellcheck=; ShellCheck unavailable), git diff check PASS. A separate network-isolated real Redis fixture passed full-window/nonmutation, natural TTL expiry, exact-boundary reservation and missing-expiry fail-closed checks; `testing/reports/auth-budget-real-redis.json`. Only its newly owned container was removed. Full promotion rerun is PENDING. No Java/application implementation changed in this correction.

PR7 prepares a genuine Document-only private-metrics identity change; its basic checks and full local JDK21 Maven verification pass150 tests, zero failures/errors/skips. All nine original local containers were restored by name and became healthy; no volume deletion/recreation or rejected socket-cleanup retry occurred. Document-only/no-op cloud proofs wait for a successful tooling baseline. Owner reports approximately VND7million remaining and permits backup infrastructure; the preferred independent runner estimate remains about USD35.14/month plus storage/usage, rather than a second GKE cluster. No backup VM/bucket or retention policy has been created. Full GCS/PITR/replay/provider recovery, scheduled monitoring delivery and approved capacity/cost gates remain open.

Pacing correction PR8 merged as45b4ba0 after both basic checks passed; full local repository quality also PASS. Build & deploy [39024083616](https://github.com/DatTranDev/docnest/actions/runs/39024083616) was dispatched once on that commit and is IN_PROGRESS. Document proof PR7 was updated with current main; only its Document implementation and documentation differ from this new baseline. Owner reports VND7million remaining. Read-only MySQL preflight verified8.4.7, ROW binlog enabled,2592000s retention and1622016 bytes across the five owned schemas. No database configuration change was needed or performed.

Follow-up coverage audit: the post-browser slow-traffic group also creates three login sessions and could exceed a still-open window. Added the same read-only four-attempt guard before smoke, billing saga, slow traffic and source-side local recovery in both CI and the isolated runner. Run39024083616 was deliberately cancelled before publication/rollout so promotion can use the complete fixture correction; it is not a passing acceptance result. Black/Prettier, actionlint and diff checks pass; the earlier actual Redis nonmutation/expiry results remain applicable because the guard and production limiter are unchanged.

Authorized backup infrastructure now exists: one independent e2-medium runner with30GiB standard boot disk, private regional recovery bucket with uniform access/public-access prevention, dedicated least-privilege identity and runner-only IAP ingress/deny rules. No extra GKE cluster, application replica or node was added. Bootstrap is IN_PROGRESS, and no successful cloud capture/restore or active schedule is claimed. The initial duplicate generic SDK repository failed signature verification; bootstrap was corrected to preserve the official image's already-authenticated cloud-sdk-bookworm source, with signature checks retained. Owner's remaining-budget report is VND7million.

Run [39030149286](https://github.com/DatTranDev/docnest/actions/runs/39030149286) failed the offline deployment checker before fixture startup/publication/rollout: ci_modes indexed the exact standalone smoke command, while pacing had combined it into a multiline run. Preserve the checker contract by using separate, sequential budget steps before each unchanged standalone acceptance command. No assertion or production limit was weakened. Actual local testing/checks/validate_deployment.py now PASS, including10 preparation contracts and15 GKE orchestration cases; actionlint and diff checks also PASS. This local offline gate was missed before the previous merge; full promotion remains required.

Actual controlled pre-backup GKE traffic PASS180 requests/zero failures,5 committed versions,1 verified export, ordinary p95=391ms/p99=2469ms and one64.516s exact slow transfer. This creates only dedicated synthetic fixtures and proves this steady-state scenario, not rollout overlap. Runner bootstrap completed with Python3.12.14, age1.3.2 and matching MySQL8.4.7 tools; protected files were delivered through private SCP directories after Windows SDK stdin truncated the initial configuration. The private age identity remains DPAPI-encrypted on the operator host; no cloud capture/restore/schedule success is claimed yet.

Authorized runner follow-up: Kubernetes authenticates the attached GCE identity by its verified numeric service-account uniqueId; the named reader RoleBinding now uses that exact principal. A runner-only10.42.0.6/32 TCP3306 NetworkPolicy and mandatory verified-CA MySQL TLS connection pass. The first full online cloud capture PASS at2026-10-17T12:13:45Z: five databases restored into disposable MySQL, referenced GCS generations and pinned signing key captured, archive encrypted and uploaded immutably to the private recovery bucket. Receipt status is CAPTURED; application/GCS restore, SQL PITR retrieval, periodic schedules and external offline-key custody remain PENDING. Upload initially failed because prefix-conditioned objectViewer did not allow bucket-level objects.list; read access is now scoped to this recovery bucket, with creation still limited to recovery/. Build & deploy39031002844 on a6608fb is IN_PROGRESS; Document-only proof remains blocked on the successful tooling baseline.

Actual cloud-backup retrieval/SQL PITR PASS38.0s: downloaded snapshot and first closed-binlog ciphertext hashes match, decryption verifies8 archived GCS objects/8394207 bytes and the original signing key, five schemas restore into owned network-isolated MySQL, and17 synthetic post-snapshot document revisions replay from the actual source binlog. Source traffic during the capture/archive interval PASS585 requests/zero failures,17 saves,2 exports, p95=218ms/p99=265ms and two exact slow transfers (longest64.422s). This is SQL-only recovery timing; no GCS generation remap, complete application recovery, Kafka/provider reconciliation or application RPO/RTO is certified. Reports: testing/reports/gke-backup-retrieval-sql-pitr.json and gke-synthetic-during-backup.json. No periodic timer or lifecycle policy has been enabled.
