"""Actual large native upload/commit/reopen probes against the full local application.

One functional probe per workload; these timings are not percentile benchmarks.
"""

import hashlib, json, pathlib, sys, time, uuid
import requests

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from run import initialize

values = initialize()
base = "http://localhost:8080"
session = requests.Session()
session.headers["Origin"] = base
csrf = session.get(base + "/api/v1/auth/csrf", timeout=10)
csrf.raise_for_status()
c = csrf.json()
session.headers[c["headerName"]] = c["token"]
email = "smoke-owner@editor.test"
password = hashlib.sha256((values["MYSQL_ROOT_PASSWORD"] + email).encode()).hexdigest()[
    :32
]
response = session.post(
    base + "/api/v1/auth/login", json={"email": email, "password": password}, timeout=20
)
response.raise_for_status()
session.headers["Authorization"] = "Bearer " + response.json()["accessToken"]


def call(method, path, **kwargs):
    r = session.request(method, base + path, timeout=120, **kwargs)
    if not r.ok:
        raise AssertionError(
            f"{method} API failed HTTP{r.status_code}: " + str(r.json().get("code"))
        )
    return r.json()


results = []
for name in [
    "ascii-long-line-10MiB.tedoc",
    "million-lines.tedoc",
    "unicode-near-10MiB.tedoc",
    "dense-10MiB.tedoc",
]:
    raw = (ROOT / "fixtures/large" / name).read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    d = call(
        "POST",
        "/api/v1/documents",
        json={
            "title": "Large validation " + name + " " + uuid.uuid4().hex[:8],
            "folderId": None,
        },
    )
    started = time.perf_counter()
    ticket = call(
        "POST",
        f"/api/v1/documents/{d['id']}/uploads",
        json={
            "expectedHeadRevision": 0,
            "nativeBytes": len(raw),
            "nativeSha256": digest,
        },
    )
    headers = dict(ticket["requiredHeaders"])
    headers["Authorization"] = session.headers["Authorization"]
    uploaded = session.put(ticket["uploadUrl"], headers=headers, data=raw, timeout=120)
    uploaded.raise_for_status()
    upload = time.perf_counter() - started
    started = time.perf_counter()
    saved = call(
        "POST",
        f"/api/v1/documents/{d['id']}/versions",
        headers={"Idempotency-Key": str(uuid.uuid4())},
        json={"uploadId": ticket["uploadId"], "expectedHeadRevision": 0},
    )
    commit = time.perf_counter() - started
    r = session.get(
        base
        + f"/api/v1/documents/{d['id']}/versions/{saved['version']['revision']}/content",
        timeout=120,
    )
    r.raise_for_status()
    assert hashlib.sha256(r.content).hexdigest() == digest
    results.append(
        {
            "workload": name,
            "nativeBytes": len(raw),
            "uploadSeconds": upload,
            "commitWithValidationSeconds": commit,
            "reopenedSha256Matches": True,
        }
    )
(ROOT / "reports/large-http.json").write_text(
    json.dumps(
        {
            "status": "PASS",
            "scope": "four actual functional probes, not percentile samples",
            "results": results,
        },
        indent=2,
    ),
    encoding="utf-8",
)
print(
    "PASS actual 10 MiB/million-line/dense native upload, validation, commit and immutable reopen (4 workloads)"
)
