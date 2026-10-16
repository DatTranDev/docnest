# Validate the implementation kit

Run from the repository root with Python 3.12.6 or later:

```text
python -m pip install -r testing/checks/requirements-implementation.txt
python testing/checks/validate_kit.py
```

The script parses OpenAPI YAML and local references, checks event examples against the schema keywords used by this kit, checks DDL structure, and checks documentation links. It writes testing/reports/kit-validation.json.

These are static kit checks. The script is not a general OpenAPI/JSON Schema validator. It does not execute SQL on MySQL, run application tests or measure benchmarks. P00 adds standard validators; P01/P02 run migrations and Testcontainers against real MySQL.

`python testing/checks/validate_deployment.py` includes `cloud_preparation_check.py`: actual offline Compose/Kustomize rendering checks exact HTTPS origins, Google Client ID and account quota, optional Stripe Prices, six scoped image digests and five migration jobs. It needs Docker Compose CLI and kubectl, but not a running Docker engine or cloud credentials.

It also runs GKE release/IAM/workflow contracts and the automatic-backup state-machine unit checks. `python testing/checks/gke_backup_crypto_check.py` requires actual `age` and `age-keygen`; it exercises the automatic helper's real archive encryption/decryption, checks fixture bytes and rejects wrong keys/tampering without cloud calls. On Windows pass `--age-directory PATH_TO_BINARIES`. CI cloud-preparation installs age and runs this check. These tests do not certify real GKE SQL/GCS capture, IAM grants, deployment or restore; the operator still performs that acceptance after [one-time Actions setup](../../docs/GKE_ONE_CLICK.md).

With Terraform 1.14+ installed, run `terraform -chdir=infra/gcp init -backend=false -input=false -lockfile=readonly`, `terraform -chdir=infra/gcp fmt -check -recursive`, `terraform -chdir=infra/gcp validate` and `terraform -chdir=infra/gcp test`. CI runs these five mocked-provider plan contracts without Google credentials. They verify none/vm/gke isolation, static IP wiring/output, cumulative budget date and invalid-origin rejection. These offline plans never provision resources and do not replace real GCS, persistence or deployment acceptance.

`collaboration-browser.cjs` accepts `SMOKE_OWNER_EMAIL` and `SMOKE_RECIPIENT_EMAIL` to select disposable fixtures on a populated local lab. Defaults remain the shared CI smoke accounts. Use two distinct test accounts with available quotas; the check retains its real ACL/convergence/restart assertions and trashes only its own document. It does not bypass account or document limits.

`python testing/checks/billing_saga_check.py` checks the five running local services with actual SQL/Kafka, broker outage, restart, duplicates, generation fencing and compensation. It requires Stripe disabled, seeds only test entitlement intents, restores the smoke owner to Free and does not certify Stripe payments. The manual **Validate application** workflow runs it after smoke when **full_acceptance** is enabled. See `docs/STRIPE_SETUP.md` for provider acceptance pending credentials.

Routine push/PR runs keep formatting, lint, types, architecture, Maven/ArchUnit and frontend unit tests, and production/static builds. Eight Docker-backed Java test classes, contracts, dependency/secret scans and Terraform checks run only with **runtime_checks** or **full_acceptance**. Cloud builds additionally request **runtime_checks**, which checks a fresh Linux MySQL bootstrap, builds/starts the local six-image application, then runs migration-only, smoke and Worker checks. The seven browser suites and billing-saga fault tests run only through manual **full_acceptance**. Checks excluded from a mode are not acceptance evidence for that run.

`python testing/checks/mysql_bootstrap_check.py` starts a disposable real MySQL instance with a mode-0644 initialization script, waits through temporary-server shutdown and verifies all five database owner logins. This exercises Linux's sourced-script behavior. It uses random credentials, no host ports or existing app volumes, and always removes its container/anonymous volume.

`node testing/checks/i18n-browser.cjs` checks English/Vietnamese login and error notices, server/client locale persistence, offline edits/undo/redo without controller or worker replacement, formatting/images/save/reopen, history/page/share/public labels and mobile billing layout against the running application. It creates a disposable document and moves it to trash afterward. No provider purchase or cloud credentials are needed. Catalog parity/interpolation/plural/error-fallback and hardcoded-copy regression checks also run in `npm test`.

`node testing/checks/structure-browser.cjs` exercises V5 lists/indent/spacing/link/table cells/page settings, native save/reopen and actual Kafka DOCX/PDF/HTML jobs against the running application. Requires Playwright Chromium and the local Compose stack. `collaboration-browser.cjs` also checks simultaneous paragraph/page changes and table cells. Evidence is generated under `testing/reports/raw/`; it is not committed.
