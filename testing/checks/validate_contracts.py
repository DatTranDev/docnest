"""Standard OpenAPI and JSON Schema validation, in addition to kit checks."""

import json, pathlib, yaml
from openapi_spec_validator import validate
from jsonschema import Draft202012Validator, FormatChecker

root = pathlib.Path(__file__).resolve().parents[2]
for path in sorted((root / "docs/contracts").glob("*openapi.yaml")):
    validate(yaml.safe_load(path.read_text(encoding="utf-8")))
count = 0
for path in sorted((root / "docs/contracts/events").glob("*.schema.json")):
    schema = json.loads(path.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    example = path.with_name(path.name.replace(".schema.json", ".example.json"))
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(
        json.loads(example.read_text(encoding="utf-8"))
    )
    count += 1
Draft202012Validator.check_schema(
    json.loads(
        (root / "docs/contracts/native-manifest.schema.json").read_text(
            encoding="utf-8"
        )
    )
)
Draft202012Validator.check_schema(
    json.loads(
        (root / "docs/contracts/native-formatting-v5.schema.json").read_text(
            encoding="utf-8"
        )
    )
)
result = {
    "openapi": "PASS",
    "eventExamples": count,
    "nativeSchema": "PASS",
    "scope": "standard static validators; no runtime inference",
}
(root / "testing/reports").mkdir(parents=True, exist_ok=True)
(root / "testing/reports/contracts.json").write_text(
    json.dumps(result, indent=2), encoding="utf-8"
)
print(json.dumps(result))
