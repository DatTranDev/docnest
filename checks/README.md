# Validate the implementation kit

Run from the extracted kit root with Python 3.11 or later:

```text
python -m pip install -r checks/requirements.txt
python checks/validate_kit.py
```

The script parses OpenAPI YAML and local references, checks event examples against the schema keywords used by this kit, independently decodes four native golden fixtures, checks DDL structure, and checks documentation links. It writes KIT_VALIDATION_REPORT.json.

These are static kit checks. The script is not a general OpenAPI/JSON Schema validator. It does not execute SQL on MySQL, run application tests or measure benchmarks. P00 adds standard validators; P01/P02 run migrations and Testcontainers against real MySQL.
