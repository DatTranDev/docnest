"""Offline contract checks for cross-project/tagged/partial digest handoffs."""

import importlib.util, json, pathlib

root = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "digests", root / "scripts/digest_manifest.py"
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
valid = {
    name: f"us-central1-docker.pkg.dev/example-lab/editor/{name}@sha256:" + ("a" * 64)
    for name in m.NAMES
}
assert m.validate_manifest(valid, "example-lab", "us-central1") == valid
cases = [
    {**valid, "web": valid["web"].replace("example-lab", "other-project")},
    {**valid, "web": valid["web"].replace("@sha256:" + "a" * 64, ":main")},
    {k: v for k, v in valid.items() if k != "web"},
    {**valid, "web": valid["web"].replace("/web@", "/identity-service@")},
]
for case in cases:
    try:
        m.validate_manifest(case, "example-lab", "us-central1")
    except ValueError:
        pass
    else:
        raise AssertionError("Unsafe handoff accepted")
(root / "reports/digest-contract.json").write_text(
    json.dumps({"status": "PASS", "checks": 5, "cloudDeployment": "NOT_RUN"}, indent=2)
    + "\n"
)
print(
    "PASS valid four-image manifest; foreign-project, mutable tag, missing service and wrong-service rejection"
)
