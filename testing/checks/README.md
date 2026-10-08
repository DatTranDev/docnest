# Validate the implementation kit

Run from the repository root with Python 3.12.6 or later:

```text
python -m pip install -r testing/checks/requirements-implementation.txt
python testing/checks/validate_kit.py
```

The script parses OpenAPI YAML and local references, checks event examples against the schema keywords used by this kit, checks DDL structure, and checks documentation links. It writes testing/reports/kit-validation.json.

These are static kit checks. The script is not a general OpenAPI/JSON Schema validator. It does not execute SQL on MySQL, run application tests or measure benchmarks. P00 adds standard validators; P01/P02 run migrations and Testcontainers against real MySQL.
