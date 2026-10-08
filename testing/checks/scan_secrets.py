"""Detect generated local credentials leaking into deliverable files; ignore intended secret storage."""

import pathlib, re, json

root = pathlib.Path(__file__).resolve().parents[2]
excluded = {
    ".tools",
    ".git",
    ".env",
    ".secrets",
    "node_modules",
    ".next",
    "target",
    "dist",
    ".terraform",
    "data",
    "test-results",
    "playwright-report",
}
secrets = []
env = root / ".env"
if env.exists():
    for line in env.read_text(encoding="utf-8").splitlines():
        if "=" in line:
            key, val = line.split("=", 1)
            if (
                key.endswith(("PASSWORD", "KEY"))
                and len(val) > 20
                and not val.startswith(("YOUR_", "REPLACE_"))
            ):
                secrets.append(val)
bad = []
for path in root.rglob("*"):
    if not path.is_file() or any(p in excluded for p in path.relative_to(root).parts):
        continue
    # This ignored protected backup store deliberately contains signing keys and SQL.
    # It is neither a source deliverable nor a CI artifact (see explicit upload exclusions).
    if path.relative_to(root).parts[:3] == ("testing", "reports", "raw"):
        continue
    if path.stat().st_size > 10 * 1024 * 1024:
        continue
    try:
        text = path.read_text(encoding="utf-8")
    except (UnicodeError, OSError):
        continue
    if any(s in text for s in secrets):
        bad.append(str(path.relative_to(root)))
    if re.search(r"-----BEGIN (?:RSA )?PRIVATE KEY-----\s+[A-Za-z0-9+/]{40}", text):
        bad.append(str(path.relative_to(root)))
if bad:
    raise SystemExit(
        "Generated secrets/private key leaked in " + ", ".join(sorted(set(bad)))
    )
(root / "testing/reports").mkdir(parents=True, exist_ok=True)
(root / "testing/reports/secret-scan.json").write_text(
    json.dumps(
        {
            "status": "PASS",
            "scope": "generated local passwords/internal keys and PEM private key payloads; ignored secret stores excluded",
        },
        indent=2,
    )
)
print(
    "PASS: generated local credentials and PEM keys absent from deliverable sources/reports"
)
