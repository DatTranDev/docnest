# Testing and benchmark plan

## Test layers

Use unit/property tests for editor and codec, Testcontainers MySQL/Kafka/Redis for database and events, HTTP contract tests from OpenAPI, Playwright for UX/permissions/conflicts, fault injection for outbox/leases/storage, and browser benchmarks for 10 MiB/one million lines. Establish correctness before optimizing. One ASCII fixture does not establish support for every workload.

## Required tests

| Area     | Cases and expectations                                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity | Argon2 verification, duplicate-email race, CSRF, JWT issuer/audience/algorithm, expiry, refresh rotation/reuse and logout                      |
| Folders  | Unique root names, accent/case policy, owner isolation, concurrent A->B/B->A without cycles, depth 20/21 and nonempty deletion                 |
| Saving   | Base 0->1, style-only change, concurrent base conflict, same-key retry, different-body key reuse, revocation between upload and commit         |
| Storage  | Missing objects, truncated uploads, size/hash mismatch, duplicate ZIP entries, zip slip, rejected compression bombs and immutable generation   |
| Sharing  | VIEWER cannot write; EDITOR cannot rename/share/delete; stranger 404; revoked link 404; public metadata has no folder/email                    |
| Recovery | Save R while editing R+1, offline/reload, IndexedDB quota, mismatched cloud head and no draft overwrite                                        |
| Editor   | Vietnamese IME, surrogates, combining marks, ZWJ, RTL, newline formatting, dense-leaf splits, style undo, redo branches and paste/replace caps |
| Kafka    | Broker outage still commits outbox; duplicate events, reordered revisions, crash after publish before marking, DLQ/replay                      |
| Jobs     | ACK after inbox commit, lease reclaim, stale workers cannot publish results, cancel races, runtime/deadline and 64 MiB output cap              |
| GC       | Retirement never deletes head; read grace; orphan cleanup leaves committed objects intact; output TTL; restore after folder deletion           |

The small editor oracle uses text and mask arrays. Generate random replace/format/undo/redo sequences of length 1–1000. After each operation, compare text, styles, length, byte counts and dirty semantics. Java/TypeScript codec tests load the same uniform/run/dense golden files. Validate fixture hashes against the manifest and independent SHA256 calculations.

## Workloads

fixtures/generate_fixtures.py --large creates a single-line 10 MiB ASCII file, 1,000,000 short lines below 10 MiB, approximately 10 MiB of mixed UTF-8 text, and dense alternating styles. Test sparse styles at 10,000 runs, typical styles at 100,000, and dense styles at 1,000,000 runs or one per grapheme. Use a fixed random seed of 42 and record bytes, UTF-16 length, lines and run count in the benchmark report.

## Measurement

Use a reference desktop with 8 GiB RAM, record browser/build versions, and fix font and viewport at 100 lines. Warm up with 5 runs. Collect at least 30 samples for open/search/serialization and at least 1000 input samples. Report median, p95, p99, peak RAM, DOM lines/spans and long tasks. Run timing profiles without devtools, then a separate memory profile. Use performance.memory only where supported and never as the sole RAM source. Compare an empty app with loaded main/worker process and heap memory. Forced GC belongs only in the harness, not application UX.

| Metric                     | Acceptance target                   |
| -------------------------- | ----------------------------------- |
| Local open ready           | p95 ≤2 seconds                      |
| Input to paint             | p95 ≤50 ms, p99 ≤100 ms             |
| Scroll frame               | p95 ≤20 ms, p99 ≤50 ms              |
| Small undo/redo            | p95 ≤50 ms                          |
| Literal first match/count  | p95 ≤500 ms                         |
| Local native serialization | p95 ≤2 seconds                      |
| Memory delta               | steady ≤256 MiB, peak ≤512 MiB      |
| DOM line elements          | target ≤500 for a 100-line viewport |

Report single-line 10 MiB and dense-style workloads separately; do not hide spikes in a combined average. For cloud load/commit, separate upload, validation, SQL commit and processing delay. Light-load hypotheses are metadata p95 ≤300 ms and 10 MiB validation p95 ≤3 seconds. These require measurement and are not SLAs. Use 5–10 virtual users in the lab; do not run large load tests outside the budget.

## Release gates

Gate A: small-file round trips, folders/sharing and conflicts pass. Gate B: randomized editor, Unicode and codec corruption tests pass. Gate C: outbox/inbox/worker fault injection passes. Gate D: the large-document benchmark has a report, and every missed target has an ADR and an explicit UI limitation. Gate E: VM/GKE smoke, backup restoration, billing and cleanup are verified. A single-node lab does not establish production readiness.

## Definition of done

Code, migrations, contracts and documents share a version. Tests run in reality and outputs are stored in reports/. Accepted features have no test.skip/TODO. Secret scans pass; restarts preserve data; save failures preserve drafts; permissions are enforced server-side. Benchmark reports contain measured results, and budget reports list still-active resources. Kit documentation validation does not prove that the application is implemented or its benchmarks pass.
