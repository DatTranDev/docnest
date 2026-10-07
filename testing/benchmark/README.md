# Browser validation

Install the repository's pinned Node dependencies and Chromium first:

```powershell
npm ci
npx playwright install chromium
```

`npm run worker-check` builds and starts a production Next.js webpack server on
`127.0.0.1:5176`, executes the six real Chromium worker protocol cases, writes
`testing/reports/worker-contract.json`, then closes its browser and server. It imports the
actual feature modules through `/worker-contract`; it uses no worker mocks or
development-server source imports. An occupied port is an error.

`npm run benchmark` generates the native fixtures, builds and starts the production
Next.js webpack server on `127.0.0.1:5174`, and measures all seven workloads through
`/benchmark`. Each workload uses five warmups, 30 measurements for opening,
scrolling, searching, serialization and undo/redo, and 1,000 input measurements.
The editor remains 1,400 by 2,000 pixels with 20-pixel lines inside the original
1,500 by 2,100 viewport. The browser process and all descendants are included in
Windows RAM measurements; three serializations form a separate memory cohort.
The report records actual sampling intervals and the observed peak's limitations.

The three representative refactor workloads use the same complete cohorts:

```powershell
$env:BENCH_WORKLOADS = 'ascii-long-line-10MiB.tedoc,million-lines.tedoc,dense-10MiB.tedoc'
$env:BENCH_REPORT_FILE = 'testing/reports/refactor-browser-benchmark.json'
try { npm run benchmark }
finally {
  Remove-Item Env:BENCH_WORKLOADS
  Remove-Item Env:BENCH_REPORT_FILE
}
```

The comparison reads `testing/benchmark/baseline/browser-benchmark.json`, preserves
that baseline, and records before/after percentile and RAM deltas. These are
observations from one cohort per version. A result with an unmet performance
target is `MEASURED_WITH_TARGET_MISSES`; successful measurement does not mean all
performance targets passed. The four workloads omitted from the representative
comparison remain unmeasured after the refactor.

Optional environment settings:

| Setting               | Meaning                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `BENCH_BASE_URL`      | Use an already running production Next server; the runner does not own or stop it.                         |
| `BENCH_WORKLOADS`     | Comma-separated exact filenames from the seven supported workloads; unknown or duplicate names fail.       |
| `BENCH_REPORT_FILE`   | Report path relative to the repository; default `testing/reports/browser-benchmark.json`.                  |
| `BENCH_BASELINE_FILE` | Comparison baseline path; default `testing/benchmark/baseline/browser-benchmark.json`.                     |
| `BENCH_QUICK=1`       | Explicit diagnostic cohort of one warmup, three measurements and 20 inputs; never an acceptance benchmark. |
| `WORKER_BASE_URL`     | Use an existing production Next server for the worker checks.                                              |
| `WORKER_REPORT_FILE`  | Worker report path; default `testing/reports/worker-contract.json`.                                        |
| `PYTHON`              | Python executable used to generate benchmark fixtures.                                                     |

Each runner hashes the actual editor feature modules and core sources before and
after execution. A source change during measurement makes the run fail. The
Windows memory sampler is bounded and closes on the runner's stop marker. Owned
servers and browsers are closed even when a workload fails.
