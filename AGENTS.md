# Repository implementation rules

Read `README.md`, `docs/AI_AGENT_GUIDE.md`, the relevant design documents, contracts, schemas, and `docs/PROJECT_STATUS.md` before implementation. ADR019 in `docs/10_DECISIONS_AND_SOURCES.md` records the accepted architectural migration. `docs/PROJECT_STATUS.md` is the sole project status checkpoint. Accepted user instructions take precedence. Continue through authorized local work without per-step approval; preserve progress across context resets.

## Ownership and dependencies

- Keep Identity, Document, and Processing separate. Each service accesses only its own MySQL database. Preserve API fields, event envelopes, native file semantics, SQL locking, optimistic revision checks, idempotency, ACL checks, and outbox/inbox guarantees.
- Organize backend features as `api` (with `api/dto` for HTTP request records), `application/command`, `application/query`, `application/port`, `domain`, and `infrastructure`; put entry points and dependency wiring in `bootstrap`.
- Domain code is plain Java and depends only on Java/domain types. Put actual business invariants in domain entities, value objects, and policies.
- Application handlers orchestrate domain operations through ports. They cannot import Spring, HTTP, JDBC, Redis, Kafka, concrete storage adapters, controllers, or another service. Processing may use the shared storage reference record as a technical port DTO.
- Controllers depend on `*Service` interfaces implemented by command/query handlers. Persistence ports use `*Repository` interfaces in `application/port`; JDBC adapters use `Jdbc*Dao` implementations in `infrastructure`. Infrastructure cannot call controllers. Cross-feature operations use explicit application interfaces. Preserve short SQL transactions; keep storage/network I/O outside them.
- Shared production code belongs in `common.codec`, `common.storage`, `common.messaging`, and `common.observability`. Never move business entities, repositories, or use cases into common. Benchmark harnesses belong in benchmark/test sources and must not ship in service jars.

## Frontend boundaries

Before UI work, read `docs/design/UI_SYSTEM.md`, `docs/ui-workflow.md`, adjacent screens/components and the relevant design gallery or audit. Define the primary user task and state matrix before implementation. Reuse established tokens and primitives; use installed design/UX skills when relevant. Preserve responsive behavior, English/Vietnamese copy, keyboard/touch access, routes, contracts, state management and local/cloud persistence semantics. Follow `docs/visual-qa.md` when a browser is available, inspect rendered output, fix observed issues, and never claim visual QA from a successful build alone. Update the design system only for justified reusable decisions.

- Use Next.js App Router with strict TypeScript. Keep routes thin and behavior under `features/auth`, `workspace`, `folders`, `documents`, `editor`, `sharing`, `export-jobs`, and `local-tools`. Local tools and their standalone static entry point must not initiate authenticated API requests or upload file contents.
- Cross-feature imports use public `index.ts` files. Do not import another feature's private implementation. `lib`, `config`, and reusable UI components cannot depend on features. Keep the import graph acyclic.
- `frontend/editor-core` stays independent of React, Next.js, and application features. Canonical text/style/history belong in editor-core and CodeMirror. Preserve viewport rendering, worker cancellation and snapshot consistency. React receives small UI state, not whole documents per keystroke.
- Initialize browser APIs in client effects or an explicitly client-only dynamic import. Keep JWTs in memory, serialize refresh-cookie mutations, preserve signed CSRF handling, and prevent private responses from shared caching.
- The production Node gateway streams bounded API bodies, blocks internal routes, and controls trusted proxy headers. Do not replace it with a buffered Next rewrite for large uploads or expose its private Next port publicly.

## Enforced checks

Java uses Spotless 3.10.3, Google Java Format 1.36.1, explicit imports, and ArchUnit. Frontend uses Prettier 3.9.9, ESLint 9.39.5 with Next/TypeScript rules, strict TypeScript, and import-boundary checks. Handwritten Python uses Black26.5.1 with Python3.12.6+; generated/dependency/output directories are excluded. Do not weaken rules or add broad suppressions. Multi-step methods stay multiline; file/function size is a review signal, not a reason to fragment cohesive behavior.

`node testing/checks/source-sizes.mjs` uses TypeScript and Java AST analysis to report handwritten files above 500 lines and functions/methods above 100 lines. Review each reported responsibility; thresholds are informational signals, not permission to split cohesive behavior mechanically or bypass correctness tests.

Set `JAVA_HOME` to JDK 21. Required automated verification is build-only, as explicitly selected by the owner on 2026-10-18: run `.\mvnw.cmd -B -ntp package '-Dmaven.test.skip=true'`, `npm run build`, and `npm run build:local`. CI uses `./mvnw`. Do not restore browser, Testcontainers, service integration, synthetic traffic or full-acceptance gates without a new owner request. Those suites and their dedicated helpers have been removed. Remaining unit/property and static policy checks are optional manual tools; they are not release requirements.

`python tooling/scripts/run.py build` packages Java without tests and builds the frontend. Formatting commands remain available: `python tooling/scripts/run.py format`, `npm run format:write`, and Maven Spotless. Optional `quality` and `test` commands do not run in CI/deploy. Preserve pinned tools and source boundaries; do not invent test results or treat a successful build as functional, persistence or performance acceptance. Record actual commands/results in `docs/PROJECT_STATUS.md`.

## Security, migrations, and cloud scope

Never log document text, email, passwords, tokens, private keys, signed URLs, resumable session URIs, or invalid event payloads. Use bounded trace identifiers and allowlisted scalar fields. Validate envelopes before correlating or retaining payloads. Invalid-event logs contain only fingerprints and broker offsets. Keep metrics on private service endpoints.

Applied migrations are immutable. Add a new version and keep `backend/schema/<service>` and service migration resources identical. Processing V3 stores nullable trace correlation; it changes no public API/event fields. Cloud uses migration jobs before rollout, with Flyway disabled in normal service startup.

Do not provision paid resources, enable billing, push cloud images, or deploy during this local task. Preserve the USD 300 total budget, placeholders, and cloud gates marked `PENDING` or `DEPLOY_PENDING`. Static checks do not prove deployment. Keep measured performance misses visible until an actual run meets the targets.
