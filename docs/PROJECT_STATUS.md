# Project status

Last updated: 2026-10-08. This is the sole human-readable project status checkpoint. Detailed design and contracts remain in `docs/` and `docs/contracts/`. Validation commands create ignored machine-readable output under `testing/reports/` when needed.

## Application

The local application is implemented: Next.js/React/CodeMirror frontend, Java/Spring Boot Identity, Document and Processing services, separate MySQL databases, Kafka outbox/inbox, Redis, local storage, and local cloud-adapter contract coverage. Authentication, folders/documents/trash, rich-text editing, native save/version/conflict handling, offline drafts, account/public sharing, previews, exports, Docker Compose, and cloud deployment preparation are implemented. Local Docker Compose currently has seven healthy services. Start with `python -X utf8 tooling/scripts/run.py up` after the prerequisites in `README.md`; open http://localhost:8080. Stop while preserving data with `python -X utf8 tooling/scripts/run.py down`.

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
- Dense-style browser performance remains the principal local performance limitation. Other P11 workloads passed in the latest seven-case run.

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
