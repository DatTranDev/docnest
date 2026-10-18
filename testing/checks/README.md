# Build verification and optional checks

The owner selected build-only CI/deploy verification on 2026-10-18. Browser, Testcontainers and service integration suites and their fixture helpers have been removed. CI does not launch a test stack, run unit/browser/integration tests, inject faults, replay SQL or generate synthetic account traffic.

From the repository root, with JDK21 and Node24:

```powershell
.\mvnw.cmd -B -ntp package '-Dmaven.test.skip=true'
npm run build
npm run build:local
```

`python tooling/scripts/run.py build` installs frontend dependencies, packages Java without compiling/running tests and builds the production frontend. Static output can also be built with `npm run build:local`.

Remaining unit/property tests and static policy scripts are optional manual tools. `npm test`, Maven `test`, `python tooling/scripts/run.py test` and `quality` are not invoked by CI/deploy. Run formatting tools when editing source; build success is not evidence of functional correctness, database races, recovery or performance.

Image publication still scans the exact image and binds immutable provenance. Deployment still checks the actual baseline, immutable migration policy, server dry-runs, selected-resource scope, Pod readiness and drain completion. It records `build-only-v1` with tests `NOT_RUN`; old historical full-acceptance evidence is retained under its original profile. Backup/recovery tools remain separate operator actions and are not automatically run by a build.
