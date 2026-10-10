# Guide for the AI coding agent

Implement and maintain the text editor with folders and sharing using these contracts, Identity, Document, Processing and the ADR027 Collaboration extension, and a USD 300 lab budget. Work through P00 to P15; P16 is optional. The accepted refactor supersedes Vite hosting and flat Java packages with Next.js App Router and feature/layer organization. Read AGENTS.md and docs/PROJECT_STATUS.md before resuming. This is the sole project status file. These instructions do not authorize cloud provisioning or changing unrelated repositories.

## Authoritative sources

1. New requirements and decisions accepted by the project owner.
2. contracts for field names, types and schemas; docs/01_PRODUCT.md and docs/05_SAVE_AND_SHARE.md for semantics and permissions.
3. docs/03_DATA_MODEL.md and schema migrations for storage and transactions.
4. docs/04_EDITOR_ENGINE.md for editor invariants and the native format.
5. docs/06_ASYNC_PROCESSING.md, the runbook and the AI plan for workflows.

Report conflicts explicitly and update relevant sources together when a justified decision is necessary. Use agreed ADRs for routine decisions and continue without per-step review prompts. The owner has authorized account-based concurrent editing (ADR027); public write access remains forbidden. Do not switch providers or adopt managed Kafka without recalculating the budget.

## Boundaries

- Each service reads and writes only its own database. Do not import another service's entities, join across databases, or use public events as an RPC for keystrokes.
- Java features use api/application command-query-port/domain/infrastructure packages and bootstrap wiring. HTTP request DTOs live in `api/dto`; controllers depend on application `*Service` interfaces implemented by command/query handlers. Domain is plain Java; application handlers use domain and `*Repository` persistence ports; `Jdbc*Dao` adapters implement those ports. Keep SQL locks, idempotency, ACL checks, optimistic revision checks, and business mutation/outbox writes in their existing effective transaction boundaries.
- Next.js routes stay thin. Cross-feature frontend imports use public index.ts files; shared technical/UI code cannot import features. Browser-only initialization belongs in client effects or a client-only dynamic boundary. editor-core remains framework independent.
- The server checks the ACL for every request that reads or writes protected data. A disabled UI button is not authorization.
- The file model must not use DOM or HTML as canonical content. Text and style commit in one editor transaction and undo together.
- Do not create a full snapshot per keystroke or store the full text in React state. Create bounded snapshots only for saving and checkpoints.
- Do not display Saved before the cloud SQL commit. Do not automatically overwrite conflicts or silently truncate content.
- Do not log passwords, refresh tokens, share tokens, API keys or full document content. Repository keys and secrets must be placeholders.
- Do not send email, create paid resources or deploy outside the authorized scope. Code, plans, dry runs and estimates are permitted; provisioning requires a specific deployment request.

## Working procedure

Read the current step and the single project checkpoint, inspect the repository, state a brief approach and implement it. Continue from the first incomplete eligible local step. Use generated DTOs when appropriate, but validate business constraints on the server. Applied migrations are immutable; add the next migration version rather than editing one already applied. Keep authoritative schema files and service resources synchronized. Write meaningful tests for invariants, races and corruption instead of assertions that merely repeat a mocked implementation. Do not use skipped tests or invented latency numbers to pass a gate.

Record each step, actual commands, results and changed files in `docs/PROJECT_STATUS.md`; keep generated evidence under `testing/reports/` without creating additional status documents. Run required formatting, imports, lint, strict types, architecture, build and tests, repair regressions, then continue to the next authorized local step. The current task authorizes the specified large benchmarks and complete local application validation; it does not authorize paid cloud work. New algorithms need oracle/property tests and comparison with the measured baseline. Mark unexecuted gates NOT_RUN with the blocker, and preserve measured target misses honestly.

Use the exact tool pins and commands in docs/versions.lock.md and AGENTS.md. CI must enforce Spotless/Google Java Format, explicit Java imports, ArchUnit, Prettier, ESLint, TypeScript, frontend import boundaries and Black for handwritten Python. Python3.12.5 is unsupported by Black's AST safety check; use Python3.12.6 or newer. Do not bypass those checks or add broad suppressions. The scoped Next lint directory adapter has genuine resolver tests; it is not a replacement for application validation.

## Definition of done

The MVP passes editing, saving and reopening with styles, folder operations, moving and trash, account sharing, public viewing and revocation, conflict and draft recovery, export jobs, schema and contract checks, and the benchmark report. Deployment passes after smoke tests, backup restoration and cost checks. Real-time collaboration is outside the MVP definition of done.

## Subscription extension

ADR028 selects Payment orchestration with participant transactional outbox/inbox; preserve the original preview/export flow. Five services own five databases. Billing APIs/schemas are in `docs/contracts/billing*` and `docs/contracts/events/billing*`; sandbox configuration is in `docs/STRIPE_SETUP.md`. Preserve generation fencing, account/saga lock order, stable provider/event idempotency and raw-byte webhook signatures. Keep Stripe test mode only until separately authorized. Provider HTTP contract tests/SQL-seeded saga checks never certify real Stripe payments. `docs/PROJECT_STATUS.md` is the sole checkpoint.
