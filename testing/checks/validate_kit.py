from pathlib import Path
import json, yaml, re, struct, hashlib, zipfile, datetime, uuid

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


def read_uleb(data, pos):
    n = 0
    for i in range(5):
        assert pos < len(data), "truncated varint"
        b = data[pos]
        pos += 1
        n |= (b & 127) << (7 * i)
        if not b & 128:
            assert i == 0 or b > 0, "noncanonical varint"
            assert n <= 0xFFFFFFFF
            return n, pos
    raise AssertionError("varint >5bytes")


def decode_styles(data):
    assert data[:8] == b"TEDSTYLE"
    ver, flags, n, count = struct.unpack_from("<HHII", data, 8)
    assert ver == 1 and flags == 0 and (count > 0 or n == 0)
    pos = 20
    masks = []
    for _ in range(count):
        tag = data[pos]
        pos += 1
        length, pos = read_uleb(data, pos)
        assert length > 0
        if tag == 0:
            mask = data[pos]
            pos += 1
            assert 0 <= mask <= 7
            masks.extend([mask] * length)
        elif tag == 1:
            nr, pos = read_uleb(data, pos)
            assert nr > 0
            total = 0
            for _ in range(nr):
                ln, pos = read_uleb(data, pos)
                mask = data[pos]
                pos += 1
                assert ln > 0 and mask <= 7
                total += ln
                masks.extend([mask] * ln)
            assert total == length
        elif tag == 2:
            words = (length + 31) // 32
            planes = []
            for _ in range(3):
                plane = list(struct.unpack_from("<" + "I" * words, data, pos))
                pos += words * 4
                if length % 32:
                    assert plane[-1] >> (length % 32) == 0
                planes.append(plane)
            for j in range(length):
                masks.append(
                    sum(
                        ((plane[j // 32] >> (j % 32)) & 1) << k
                        for k, plane in enumerate(planes)
                    )
                )
        else:
            raise AssertionError("unknown tag")
    assert pos == len(data) and len(masks) == n
    return n, masks


manifest_schema = json.loads(
    (P / "docs/contracts/native-manifest.schema.json").read_text()
)
ledger = json.loads((P / "testing/fixtures/native/index.json").read_text())
assert len(ledger) >= 4
ledger = [
    x
    for x in ledger
    if x["file"]
    in {"empty.tedoc", "unicode-uniform.tedoc", "mixed-runs.tedoc", "dense-ascii.tedoc"}
]
assert len(ledger) == 4
for item in ledger:
    path = P / "testing/fixtures/native" / item["file"]
    raw = path.read_bytes()
    assert (
        len(raw) == item["nativeBytes"]
        and hashlib.sha256(raw).hexdigest() == item["nativeSha256"]
    )
    with zipfile.ZipFile(path) as z:
        assert z.namelist() == ["manifest.json", "text.utf8", "styles.bin"] and all(
            x.compress_type == 0 for x in z.infolist()
        )
        assert z.testzip() is None
        m = json.loads(z.read("manifest.json"))
        text = z.read("text.utf8")
        styles = z.read("styles.bin")
    assert_schema(manifest_schema, m, item["file"])
    decoded = text.decode("utf-8", "strict")
    n, masks = decode_styles(styles)
    assert len(decoded.encode("utf-16-le")) // 2 == n == m["utf16Length"]
    assert len(text) == m["utf8Bytes"] and decoded.count("\n") + 1 == m["logicalLines"]
    assert (
        hashlib.sha256(text).hexdigest() == m["textSha256"]
        and hashlib.sha256(styles).hexdigest() == m["stylesSha256"]
    )
    if item["styleKind"] == "uniform":
        assert masks == [item["uniformMask"]] * n
    elif item["styleKind"] == "runs":
        assert masks == [x for length, mask in item["runs"] for x in [mask] * length]
    else:
        assert masks == [j % 8 for j in range(n)]
ok(
    "Four golden native fixtures independently decoded; ZIP, header, style tags, UTF16, lines and SHA256 round trip verified"
)

# Validate the oracle catches actual corruption rather than accepting every input.
sample = P / "testing/fixtures/native/dense-ascii.tedoc"
with zipfile.ZipFile(sample) as z:
    data = z.read("styles.bin")
for bad in [
    data + b"X",
    data[:19],
    b"BROKEN!!" + data[8:],
    data[:20] + b"\x09" + data[21:],
]:
    try:
        decode_styles(bad)
    except (AssertionError, struct.error, IndexError):
        pass
    else:
        raise AssertionError("corruption accepted")
ok(
    "Independent fixture decoder rejects extra bytes, truncated header, bad magic and unknown style tag"
)

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
    "scope": "Static contract/document checks and native fixture verification only. Application, deployment and benchmark evidence is recorded separately in testing/reports/.",
}
(P / "testing/reports").mkdir(parents=True, exist_ok=True)
(P / "testing/reports/kit-validation.json").write_text(
    json.dumps(report, ensure_ascii=False, indent=2) + "\n"
)
print(json.dumps(report, ensure_ascii=False, indent=2))
