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

- Use Next.js App Router with strict TypeScript. Keep routes thin and behavior under `features/auth`, `workspace`, `folders`, `documents`, `editor`, `sharing`, `export-jobs`, and `local-tools`. Local tools and their standalone static entry point must not initiate authenticated API requests or upload file contents.
- Cross-feature imports use public `index.ts` files. Do not import another feature's private implementation. `lib`, `config`, and reusable UI components cannot depend on features. Keep the import graph acyclic.
- `frontend/editor-core` stays independent of React, Next.js, and application features. Canonical text/style/history belong in editor-core and CodeMirror. Preserve viewport rendering, worker cancellation and snapshot consistency. React receives small UI state, not whole documents per keystroke.
- Initialize browser APIs in client effects or an explicitly client-only dynamic import. Keep JWTs in memory, serialize refresh-cookie mutations, preserve signed CSRF handling, and prevent private responses from shared caching.
- The production Node gateway streams bounded API bodies, blocks internal routes, and controls trusted proxy headers. Do not replace it with a buffered Next rewrite for large uploads or expose its private Next port publicly.

## Enforced checks

Java uses Spotless 3.10.3, Google Java Format 1.36.1, explicit imports, and ArchUnit. Frontend uses Prettier 3.9.9, ESLint 9.39.5 with Next/TypeScript rules, strict TypeScript, and import-boundary checks. Handwritten Python uses Black26.5.1 with Python3.12.6+; generated/dependency/output directories are excluded. Do not weaken rules or add broad suppressions. Multi-step methods stay multiline; file/function size is a review signal, not a reason to fragment cohesive behavior.

`node testing/checks/source-sizes.mjs` uses TypeScript and Java AST analysis to report handwritten files above 500 lines and functions/methods above 100 lines. Review each reported responsibility; thresholds are informational signals, not permission to split cohesive behavior mechanically or bypass correctness tests.

Set `JAVA_HOME` to JDK 21. On Windows run `.\mvnw.cmd -B -ntp spotless:apply` to format and `.\mvnw.cmd -B -ntp verify` for format/build/tests/architecture. CI uses `./mvnw`.

Run `python testing/checks/java_imports.py`, `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run architecture`, `node --test testing/checks/next-lint-glob.test.mjs`, `node --test frontend/web/server/gateway.test.mjs`, `npm test`, and `npm run build`. `npm run format:write` applies frontend/document formatting. The scoped `tooling/lint-glob` adapter supports Next's actual `globSync` directory-resolver contract; preserve its contract tests.

`python tooling/scripts/run.py format` applies POM/Java/frontend formatting. `python tooling/scripts/run.py quality` runs the repository quality gates. `python tooling/scripts/run.py test` runs quality, contract validation, Maven verification and frontend tests. Run from the repository root after prerequisites in README.md; these commands never provision cloud infrastructure.

Meaningful changes require relevant unit/property, real-service integration, contract, and browser tests. Required races and persistence gates use actual MySQL/Kafka/Redis/storage behavior. Never substitute skipped tests, mocks, or invented benchmarks for those gates. Record commands and results; mark unavailable checks `NOT_RUN` with the blocker. Final reports follow execution.

## Security, migrations, and cloud scope

Never log document text, email, passwords, tokens, private keys, signed URLs, resumable session URIs, or invalid event payloads. Use bounded trace identifiers and allowlisted scalar fields. Validate envelopes before correlating or retaining payloads. Invalid-event logs contain only fingerprints and broker offsets. Keep metrics on private service endpoints.

Applied migrations are immutable. Add a new version and keep `backend/schema/<service>` and service migration resources identical. Processing V3 stores nullable trace correlation; it changes no public API/event fields. Cloud uses migration jobs before rollout, with Flyway disabled in normal service startup.

Do not provision paid resources, enable billing, push cloud images, or deploy during this local task. Preserve the USD 300 total budget, placeholders, and cloud gates marked `PENDING` or `DEPLOY_PENDING`. Static checks do not prove deployment. Keep measured performance misses visible until an actual run meets the targets.
