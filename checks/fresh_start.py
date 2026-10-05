"""Execute the documented startup in a new isolated local project/volumes; delete only that project."""

import hashlib, json, os, pathlib, secrets, subprocess, sys, time, uuid
import requests

ROOT = pathlib.Path(__file__).resolve().parents[1]
os.chdir(ROOT)
project = "text-editor-fresh-" + secrets.token_hex(4)
origin = "http://localhost:8081"
env = os.environ.copy()
env.update(COMPOSE_PROJECT_NAME=project, WEB_PORT="8081", WEB_ORIGIN=origin)
started = time.perf_counter()
checks = []
result = {
    "status": "FAILED",
    "scope": "isolated local fresh volumes/DBs using documented startup; no cloud",
}


def call(s, method, path, expected=200, **kwargs):
    r = s.request(method, origin + path, timeout=60, **kwargs)
    assert r.status_code == expected, f"{method} fresh API HTTP{r.status_code}"
    return r.json() if r.content else None


def account(email):
    s = requests.Session()
    s.headers["Origin"] = origin
    c = call(s, "GET", "/api/v1/auth/csrf")
    s.headers[c["headerName"]] = c["token"]
    call(
        s,
        "POST",
        "/api/v1/auth/register",
        201,
        json={
            "email": email,
            "password": "Fresh-test-password-42!",
            "displayName": "Fresh synthetic account",
        },
    )
    login = call(
        s,
        "POST",
        "/api/v1/auth/login",
        json={"email": email, "password": "Fresh-test-password-42!"},
    )
    s.headers["Authorization"] = "Bearer " + login["accessToken"]
    return s


try:
    subprocess.run(
        [sys.executable, "-X", "utf8", "scripts/run.py", "up"], env=env, check=True
    )
    checks.append("documented startup builds and seven containers become healthy")
    owner = account("fresh-owner@example.test")
    other = account("fresh-recipient@example.test")
    checks.append("two accounts register/login on initially empty Identity DB")
    folder = call(
        owner,
        "POST",
        "/api/v1/folders",
        201,
        json={"name": "Fresh private folder", "parentId": None},
    )
    call(other, "GET", "/api/v1/folders/" + folder["id"], 404)
    checks.append("folder created and private across users")
    doc = call(
        owner,
        "POST",
        "/api/v1/documents",
        201,
        json={"title": "Fresh formatted file", "folderId": folder["id"]},
    )
    raw = (ROOT / "fixtures/native/mixed-runs.tedoc").read_bytes()
    ticket = call(
        owner,
        "POST",
        f"/api/v1/documents/{doc['id']}/uploads",
        201,
        json={
            "expectedHeadRevision": 0,
            "nativeBytes": len(raw),
            "nativeSha256": hashlib.sha256(raw).hexdigest(),
        },
    )
    upload = owner.put(
        ticket["uploadUrl"], headers=ticket["requiredHeaders"], data=raw, timeout=30
    )
    upload.raise_for_status()
    saved = call(
        owner,
        "POST",
        f"/api/v1/documents/{doc['id']}/versions",
        201,
        json={"uploadId": ticket["uploadId"], "expectedHeadRevision": 0},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    reopened = owner.get(
        origin + f"/api/v1/documents/{doc['id']}/versions/1/content", timeout=30
    )
    reopened.raise_for_status()
    assert reopened.content == raw
    checks.append(
        "formatted native upload/save/reopen is byte exact with new signing key/storage"
    )
    call(
        owner,
        "POST",
        f"/api/v1/documents/{doc['id']}/permissions",
        json={"email": "fresh-recipient@example.test", "role": "VIEWER"},
    )
    assert (
        call(other, "GET", f"/api/v1/documents/{doc['id']}")["effectiveRole"]
        == "VIEWER"
    )
    checks.append("sharing reaches second user on fresh DBs")
    result.update(
        status="PASS",
        checks=checks,
        startupAndProbeSeconds=time.perf_counter() - started,
    )
finally:
    # Only this randomly named, task-created project owns these disposable volumes.
    cleanup = subprocess.run(
        [sys.executable, "-X", "utf8", "scripts/run.py", "down"], env=env
    )
    purge = subprocess.run(
        [
            "docker",
            "compose",
            "--project-name",
            project,
            "--env-file",
            ".env",
            "-f",
            "infra/compose/compose.yaml",
            "--profile",
            "app",
            "down",
            "-v",
            "--remove-orphans",
        ],
        env=env,
    )
    result["isolatedProjectCleanupPassed"] = (
        cleanup.returncode == 0 and purge.returncode == 0
    )
    (ROOT / "reports/fresh-start.json").write_text(
        json.dumps(result, indent=2), encoding="utf-8"
    )
print(
    "PASS fresh isolated application startup, two users, private folders, formatted saving and sharing; temporary resources removed"
)
