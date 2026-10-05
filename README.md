# Text editor application and implementation kit

The application is implemented in `apps/web`, `packages/editor-core` and the three Java services. See `reports/progress.md` for current project status, validation and measured limitations. Cloud deployment remains deferred; follow `docs/CLOUD_SETUP_HANDOFF.md` when deployment is separately authorized.

## Run locally

Prerequisites: Docker Desktop with Linux containers/WSL2, Docker Compose v2, Python3.12.6+, at least8GiB assigned to Docker, and free localhost port8080. Startup builds the Java21 and Node24 applications in pinned multi-stage images. No cloud account is needed. From the repository root:

```text
python -X utf8 scripts/run.py up
```

Open http://localhost:8080 and register two test accounts. Local-only secrets are generated into ignored `.env`; persistent volumes retain SQL, Kafka, snapshots and the signing key. Defaults allow10accounts,100documents/folders per owner and20published versions. Credentials created at first MySQL initialization must stay consistent with that volume. Changing `.env` does not reset users in an existing database.

Additional development/test prerequisites: JDK21 (`JAVA_HOME`), Node24, Git, and `python -m pip install -r checks/requirements-implementation.txt`. Install frontend dependencies with `npm ci` and Chromium with `npx playwright install chromium`. Maven Wrapper downloads Maven3.9.16 on first use. On Unix use `chmod +x mvnw` if checkout did not preserve executable bits.

```text
python -X utf8 scripts/run.py build
python -X utf8 scripts/run.py test
python -X utf8 scripts/run.py quality
python -X utf8 scripts/run.py format
npm run lint
python -X utf8 scripts/run.py smoke
python -X utf8 scripts/run.py infra-check
python -X utf8 scripts/run.py e2e
python -X utf8 scripts/run.py benchmark
python -X utf8 scripts/run.py backup
python -X utf8 scripts/run.py down
```

`build` runs backend tests and frontend compilation. `test` enforces contract checks, Java/POM/Prettier formatting, explicit imports, frontend boundaries, strict types, ESLint, gateway contracts, JUnit/ArchUnit/Testcontainers and Vitest properties; Docker must be available. `quality` runs the source gates without integration tests. `format` applies pinned Java/POM/Prettier/Black formatting. These commands work on Windows and Linux. Production Next.js App Router runs behind a streaming same-origin gateway; Spring services retain business authority. `smoke`, `infra-check` and `e2e` require the running full application and exercise real services. Run these commands sequentially: smoke/infra-check intentionally restart services. E2E reuses four synthetic accounts and unique titles; set E2E_OWNER_EMAIL/E2E_EDITOR_EMAIL/E2E_RECOVERY_EMAIL/E2E_QUOTA_EMAIL when testing an existing lab whose ten-account quota is already full. All use the synthetic test password in the test source. `benchmark` generates fixtures, builds production assets and starts/stops its own server on5174; reports identify every missed target. `python scripts/benchmark-native.py` adds Java validation distributions; `python checks/large_http.py` exercises four full-service large-file round trips after smoke. Stop preserves volumes; `docker compose ... down -v` destroys local data and is not the normal shutdown command. Restore is explicit: `python scripts/run.py restore --backup-path PATH --confirm-restore`. `infra-up` exposes infrastructure on loopback only for native service development. Base Compose publishes no database/cache/broker ports. Kafka uses service-specific SASL credentials and exact topic/group ACLs; see infra/compose/kafka-security.md. Replay validates first: `python scripts/replay_event.py --topic TOPIC --file FILE --dry-run`; publication requires --publish.

Local backup briefly stops running application services to capture consistent SQL, immutable objects, and signing keys, then resumes those services automatically. Infrastructure remains running. `python checks/backup_restore_check.py` exercises backup and restore only against this task's synthetic local lab; restoration replaces its database contents.

Cloud configuration can be checked without credentials: `terraform -chdir=infra/gcp init -backend=false`, `terraform -chdir=infra/gcp validate`, `kubectl kustomize infra/k8s/overlays/lab`, and `python checks/validate_deployment.py`. Do not run Terraform apply during local implementation. Original kit specifications follow.

Scan the four built application images anonymously with `python checks/install_trivy.py`, then `python checks/image_os_scan.py --download-db`. The installer verifies the pinned official Trivy release checksum; the scan records immutable local image IDs, OS package advisories and DB dates in `reports/image-os-scan.json`. CI fails on high/critical findings or incomplete scans. Medium/low findings remain visible and require review before rollout; see [scan scope and reproduction](checks/IMAGE_OS_SCAN.md).

Version 1.0, English edition, 4 October 2026. The target is a web application that edits up to 10 MiB of text and one million lines, preserves bold, italic and underline when saving, organizes documents in folders, and supports document sharing. The three backend services are Identity, Document and Processing. The total Google Cloud lab budget is USD 300.

The original kit supplies specifications, contracts, SQL and fixtures. This repository now also includes application code, Dockerfiles, Kubernetes manifests and validation scripts. Provisioned cloud infrastructure is intentionally absent.

## Getting started

1. Read docs/01_PRODUCT.md and docs/02_ARCHITECTURE.md for product behavior and data ownership.
2. Use contracts/openapi.yaml, contracts/events/_.schema.json and schema/_/V1__init.sql as implementation contracts.
3. Read docs/04_EDITOR_ENGINE.md and docs/05_SAVE_AND_SHARE.md before building the editor and save flow.
4. Give AI_AGENT_GUIDE.md and docs/08_AI_IMPLEMENTATION_PLAN.md to the AI coding agent. Start with P00. Complete one step at a time and verify its acceptance gate.
5. Run fixtures/generate_fixtures.py to generate sample files. Small fixtures are already included in fixtures/native; generate large workloads when needed.

## Contents

| File                                  | Purpose                                                         |
| ------------------------------------- | --------------------------------------------------------------- |
| docs/01_PRODUCT.md                    | Scope, screens, user stories and functional acceptance criteria |
| docs/02_ARCHITECTURE.md               | Three services, stack, data flow and trade-offs                 |
| docs/03_DATA_MODEL.md                 | Three databases, tables, indexes and transactions               |
| docs/04_EDITOR_ENGINE.md              | Text tree, StyleTree, viewport, history, search and codec       |
| docs/05_SAVE_AND_SHARE.md             | Saving, conflicts, autosave, folders, ACL and public links      |
| docs/06_ASYNC_PROCESSING.md           | Kafka, outbox, inbox, worker leases, retries and Redis          |
| docs/07_GOOGLE_CLOUD_RUNBOOK.md       | Docker, VM, GKE, CI/CD, costs and cleanup                       |
| docs/08_AI_IMPLEMENTATION_PLAN.md     | Steps P00 through P16 and implementation prompts                |
| docs/09_TEST_AND_BENCHMARK.md         | Functional tests, distributed failures and benchmarks           |
| docs/10_DECISIONS_AND_SOURCES.md      | Architecture decisions and official references                  |
| contracts/openapi.yaml                | Public HTTP contracts and internal endpoints                    |
| contracts/native-manifest.schema.json | Native file manifest                                            |
| contracts/events                      | Four event schemas and examples                                 |
| contracts/snapshot.proto              | Optional gRPC exercise in P16                                   |
| schema                                | Initial migrations for each service                             |
| fixtures                              | Native golden files and workload generator                      |
| checks                                | Portable static checks and validation report                    |
| docs/diagrams                         | PNG and SVG diagrams for review and reuse                       |
| docs/implementation-plan.json         | All 17 implementation steps as structured data                  |
| AI_AGENT_GUIDE.md                     | Working rules and order of authoritative sources                |

## Validating the kit

See checks/README.md to rerun static checks and native fixture verification. KIT_VALIDATION_REPORT.json records static validation only. Executed application gates and deferred cloud gates are tracked in reports/progress.md.

## Agreed decisions

- Personal folders form a tree with a maximum depth of 20. Sharing applies to documents; folder permissions are not inherited.
- Grant VIEWER or EDITOR access to an existing account. Public links are read-only, expire, and can be revoked.
- Each cloud version is an immutable snapshot. Saving uses expectedHeadRevision and an idempotency key. Conflicts must never silently overwrite another version.
- The MVP does not include real-time editing. Multiple editors can open the same document; competing commits are detected.
- The lab uses one MySQL instance, three logical databases and three separate application database users. Services must not query or join another service's database.
- Canonical text is limited to 10,485,760 UTF-8 bytes with LF line endings and 1,000,000 logical lines. The native container is limited to 32 MiB.
- Load the complete text and style model into memory and render only the visible region. Only one large document is active at a time.
- Specification performance figures and costs are targets or estimates. Actual measured application results and remaining limits are in docs/11_PERFORMANCE_ACCEPTANCE.md and reports/progress.md.

## Consistency rules

Machine-readable contracts define field names, types and enums. Documents define semantics and access rules. If they conflict, update both in the same change and record an ADR; do not silently choose one. This kit extends the editor design dated 30 September 2026 and preserves the adaptive-v1 codec.

All documentation, prompts, captions and diagram labels in this edition are in English. Unicode test payloads intentionally retain multilingual text, combining marks and emoji. The English edition preserves API identifiers, SQL definitions, event schemas and fixture bytes.
