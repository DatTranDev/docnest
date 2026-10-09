# Validate the implementation kit

Run from the repository root with Python 3.12.6 or later:

```text
python -m pip install -r testing/checks/requirements-implementation.txt
python testing/checks/validate_kit.py
```

The script parses OpenAPI YAML and local references, checks event examples against the schema keywords used by this kit, checks DDL structure, and checks documentation links. It writes testing/reports/kit-validation.json.

These are static kit checks. The script is not a general OpenAPI/JSON Schema validator. It does not execute SQL on MySQL, run application tests or measure benchmarks. P00 adds standard validators; P01/P02 run migrations and Testcontainers against real MySQL.

`python testing/checks/billing_saga_check.py` checks the five running local services with actual SQL/Kafka, broker outage, restart, duplicates, generation fencing and compensation. It requires Stripe disabled, seeds only test entitlement intents, restores the smoke owner to Free and does not certify Stripe payments. The CI runs it after the real-service smoke. See `docs/STRIPE_SETUP.md` for provider acceptance pending credentials.

`node testing/checks/i18n-browser.cjs` checks English/Vietnamese login and error notices, server/client locale persistence, offline edits/undo/redo without controller or worker replacement, formatting/images/save/reopen, history/page/share/public labels and mobile billing layout against the running application. It creates a disposable document and moves it to trash afterward. No provider purchase or cloud credentials are needed. Catalog parity/interpolation/plural/error-fallback and hardcoded-copy regression checks also run in `npm test`.

`node testing/checks/structure-browser.cjs` exercises V5 lists/indent/spacing/link/table cells/page settings, native save/reopen and actual Kafka DOCX/PDF/HTML jobs against the running application. Requires Playwright Chromium and the local Compose stack. `collaboration-browser.cjs` also checks simultaneous paragraph/page changes and table cells. Evidence is generated under `testing/reports/raw/`; it is not committed.
