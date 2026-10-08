from pathlib import Path
import json, yaml, re, datetime, uuid

P = Path(__file__).resolve().parents[2]
checks = []


def ok(label):
    checks.append(label)


def assert_schema(s, v, path="value"):
    if "anyOf" in s:
        failures = []
        for sub in s["anyOf"]:
            try:
                assert_schema(sub, v, path)
                return
            except AssertionError as e:
                failures.append(str(e))
        raise AssertionError(path + ": no anyOf match " + str(failures))
    if "const" in s:
        assert v == s["const"], (path, "const", v)
    if "enum" in s:
        assert v in s["enum"], (path, "enum", v)
    ty = s.get("type")
    allowed = ty if isinstance(ty, list) else [ty] if ty else []
    typ = {
        "null": lambda x: x is None,
        "string": lambda x: isinstance(x, str),
        "integer": lambda x: isinstance(x, int) and not isinstance(x, bool),
        "boolean": lambda x: isinstance(x, bool),
        "object": lambda x: isinstance(x, dict),
        "array": lambda x: isinstance(x, list),
        "number": lambda x: isinstance(x, (int, float)) and not isinstance(x, bool),
    }
    if allowed:
        assert any(typ[t](v) for t in allowed), (path, "type", ty, v)
    if v is None:
        return
    if isinstance(v, dict):
        for k in s.get("required", []):
            assert k in v, (path, "required", k)
        props = s.get("properties", {})
        if s.get("additionalProperties") is False:
            assert not set(v) - set(props), (path, "extra", set(v) - set(props))
        for k, x in v.items():
            if k in props:
                assert_schema(props[k], x, path + "." + k)
    if isinstance(v, list) and "items" in s:
        for i, x in enumerate(v):
            assert_schema(s["items"], x, path + f"[{i}]")
    if isinstance(v, str):
        if "maxLength" in s:
            assert len(v) <= s["maxLength"], path
        if "minLength" in s:
            assert len(v) >= s["minLength"], path
        if "pattern" in s:
            assert re.search(s["pattern"], v), path
        if s.get("format") == "uuid":
            uuid.UUID(v)
        if s.get("format") == "date-time":
            datetime.datetime.fromisoformat(v.replace("Z", "+00:00"))
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        if "minimum" in s:
            assert v >= s["minimum"], path
        if "maximum" in s:
            assert v <= s["maximum"], path


spec = yaml.safe_load((P / "docs/contracts/openapi.yaml").read_text())
assert spec["openapi"] == "3.0.3"
opids = []


def findrefs(v):
    if isinstance(v, dict):
        if "$ref" in v:
            r = v["$ref"]
            assert r.startswith("#/"), r
            found = spec
            for key in r[2:].split("/"):
                found = found[key]
        for x in v.values():
            findrefs(x)
    elif isinstance(v, list):
        for x in v:
            findrefs(x)


findrefs(spec)
for path, item in spec["paths"].items():
    vars = set(re.findall(r"\{([^}]+)\}", path))
    for method, op in item.items():
        opids.append(op["operationId"])
        pars = op.get("parameters", [])
        assert {x["name"] for x in pars if x["in"] == "path"} == vars, (path, method)
        assert all(x["required"] is True for x in pars if x["in"] == "path")
        assert any(k.startswith("2") for k in op["responses"]), (path, method)
        assert op["x-service"] in [
            "identity-service",
            "document-service",
            "processing-service",
        ]
assert len(set(opids)) == len(opids)
assert len(opids) == 41
for route in ["/api/v1/public/shares/{token}", "/api/v1/public/shares/{token}/content"]:
    assert spec["paths"][route]["get"]["security"] == []
for operation in ["commitVersion", "createJob"]:
    op = next(
        v
        for item in spec["paths"].values()
        for v in item.values()
        if v["operationId"] == operation
    )
    assert any(
        x["name"] == "Idempotency-Key" and x["required"] for x in op["parameters"]
    )
ok(
    "OpenAPI YAML parsed: 41 unique operations, all local refs/path parameters resolve, expected security and idempotency headers present"
)

schemas = []
for f in (P / "docs/contracts/events").glob("*.schema.json"):
    s = json.loads(f.read_text())
    example = json.loads(f.with_name(f.name.replace(".schema", ".example")).read_text())
    assert_schema(s, example, f.name)
    schemas.append(s)
assert len(schemas) == 4
ok("Four event schemas parse and examples satisfy all schema keywords used by this kit")


table_names = {}
for service in ["identity", "document", "processing"]:
    sql = (P / f"backend/schema/{service}/V1__init.sql").read_text()
    names = re.findall(r"CREATE TABLE (\w+)", sql)
    assert len(names) == len(set(names))
    assert not re.search(r"REFERENCES\s+\w+\.", sql), service
    for fk in re.findall(r"REFERENCES\s+(\w+)\(", sql):
        assert fk in names, (service, fk)
    table_names[service] = names
assert (
    len(table_names["identity"]) == 2
    and len(table_names["document"]) == 10
    and len(table_names["processing"]) == 5
)
ok(
    "DDL structural checks: 2/10/5 tables, all FK targets local; no SQL execution or MySQL runtime validation claimed"
)

excluded = {
    ".tools",
    "node_modules",
    "target",
    "dist",
    ".git",
    ".terraform",
    "test-results",
    "playwright-report",
}
allmd = [
    f
    for f in P.rglob("*.md")
    if not any(part in excluded for part in f.relative_to(P).parts)
]
for f in allmd:
    text = f.read_text(encoding="utf-8")
    assert text.count("~~~") % 2 == 0, f
    for t in re.findall(r"(?<![\w/])(docs/[A-Z0-9_]+\.md)", text):
        assert (P / t).exists(), (f, t)
plan = (P / "docs/08_AI_IMPLEMENTATION_PLAN.md").read_text()
assert len(re.findall(r"^### P\d\d ", plan, re.M)) == 17
assert all(f"### P{i:02d} " in plan for i in range(17))
ok("Documentation links, fenced blocks and all 17 implementation steps present")
report = {
    "status": "PASS",
    "checks": checks,
    "openapi_operations": len(opids),
    "database_tables": table_names,
    "scope": "Static contract/document checks only. Application, deployment and benchmark evidence is recorded separately in testing/reports/.",
}
(P / "testing/reports").mkdir(parents=True, exist_ok=True)
(P / "testing/reports/kit-validation.json").write_text(
    json.dumps(report, ensure_ascii=False, indent=2) + "\n"
)
print(json.dumps(report, ensure_ascii=False, indent=2))
