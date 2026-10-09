"""Real HTTP + SQL + Kafka application acceptance. Requires full Compose application."""

import concurrent.futures, hashlib, io, json, os, pathlib, sys, time, uuid, zipfile
import requests, yaml
from openapi_schema_validator import OAS30Validator
from jsonschema import RefResolver

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "testing/benchmark"))
from native_input import generate

generate(ROOT / "testing/benchmark/generated")
sys.path.insert(0, str(ROOT / "tooling/scripts"))
from run import compose, initialize

values = initialize()
BASE = os.environ.get("EDITOR_BASE_URL", "http://localhost:8080")
api = yaml.safe_load((ROOT / "docs/contracts/openapi.yaml").read_text(encoding="utf-8"))
checks = []
started = time.time()


def note(message):
    checks.append(message)
    print("PASS " + message, flush=True)


def call(session, method, path, expected=200, **kw):
    url = path if path.startswith("http") else BASE + path
    r = session.request(method, url, timeout=140, **kw)
    statuses = expected if isinstance(expected, tuple) else (expected,)
    if r.status_code not in statuses:
        code = (
            r.json().get("code", "")
            if "application/json" in r.headers.get("content-type", "")
            else ""
        )
        raise AssertionError(
            f"{method} request expected {statuses}, received {r.status_code} {code}"
        )
    if "application/json" in r.headers.get("content-type", ""):
        data = r.json()
        # Validate against exact path response without ever printing protected response values.
        import re, urllib.parse

        actual = urllib.parse.urlparse(url).path
        for pattern, methods in api["paths"].items():
            if re.fullmatch(re.sub(r"\{[^}]+\}", r"[^/]+", pattern), actual):
                definition = methods[method.lower()]["responses"].get(
                    str(r.status_code), {}
                )
                if "$ref" in definition:
                    definition = api["components"]["responses"][
                        definition["$ref"].split("/")[-1]
                    ]
                schema = (
                    definition.get("content", {})
                    .get("application/json", {})
                    .get("schema")
                )
                if schema:
                    OAS30Validator(
                        schema, resolver=RefResolver.from_schema(api)
                    ).validate(data)
                break
        return data
    return r


def account(email):
    s = requests.Session()
    csrf = call(s, "GET", "/api/v1/auth/csrf")
    s.headers.update({"Origin": BASE, csrf["headerName"]: csrf["token"]})
    password = hashlib.sha256(
        (values["MYSQL_ROOT_PASSWORD"] + email).encode()
    ).hexdigest()[:32]
    call(
        s,
        "POST",
        "/api/v1/auth/register",
        (201, 409),
        json={"email": email, "password": password, "displayName": email.split("@")[0]},
    )
    token = call(
        s, "POST", "/api/v1/auth/login", json={"email": email, "password": password}
    )
    s.headers["Authorization"] = "Bearer " + token["accessToken"]
    return s, token["user"]


def upload(s, doc, data, head):
    ticket = call(
        s,
        "POST",
        f"/api/v1/documents/{doc}/uploads",
        201,
        json={
            "expectedHeadRevision": head,
            "nativeBytes": len(data),
            "nativeSha256": hashlib.sha256(data).hexdigest(),
        },
    )
    call(
        s,
        "PUT",
        ticket["uploadUrl"],
        (200, 204),
        data=data,
        headers=ticket["requiredHeaders"],
    )
    return ticket


def commit(s, doc, ticket, head, key=None, expected=(200, 201)):
    return call(
        s,
        "POST",
        f"/api/v1/documents/{doc}/versions",
        expected,
        json={"uploadId": ticket["uploadId"], "expectedHeadRevision": head},
        headers={"Idempotency-Key": key or str(uuid.uuid4())},
    )


def wait_job(s, job):
    for _ in range(100):
        j = call(s, "GET", f"/api/v1/jobs/{job}")
        if j["state"] in ["SUCCEEDED", "FAILED", "CANCELLED"]:
            return j
        time.sleep(0.4)
    raise AssertionError("Job failed to finish within40s")


def main():
    anon = requests.Session()
    call(anon, "GET", "/internal/v1/users/" + str(uuid.uuid4()), 404)
    call(
        anon,
        "POST",
        "/api/v1/auth/login",
        403,
        json={"email": "fake@example.test", "password": "bad"},
    )
    alice, ua = account("smoke-owner@editor.test")
    bob, ub = account("smoke-recipient@editor.test")
    call(alice, "GET", "/api/v1/auth/me")
    old_refresh = alice.cookies.get("refresh_token")
    refreshed = call(alice, "POST", "/api/v1/auth/refresh")
    alice.headers["Authorization"] = "Bearer " + refreshed["accessToken"]
    assert alice.cookies.get("refresh_token") != old_refresh
    note("Registration, login, CSRF, JWT/me and refresh rotation with two real users")
    folder = call(
        alice,
        "POST",
        "/api/v1/folders",
        201,
        json={"name": "smoke-" + uuid.uuid4().hex[:8], "parentId": None},
    )
    fid = folder["id"]
    call(bob, "GET", f"/api/v1/folders/{fid}", 404)
    call(
        alice,
        "POST",
        "/api/v1/folders",
        409,
        json={"name": folder["name"].upper(), "parentId": None},
    )
    doc = call(
        alice,
        "POST",
        "/api/v1/documents",
        201,
        json={"title": "Unicode styled smoke", "folderId": fid},
    )
    did = doc["id"]
    assert doc["headRevision"] == 0 and doc["headVersionId"] is None
    call(
        alice,
        "DELETE",
        f'/api/v1/folders/{fid}?expectedMetadataRevision={folder["metadataRevision"]}',
        409,
    )
    call(bob, "GET", f"/api/v1/documents/{did}", 404)
    note(
        "Private folders, case-insensitive duplicate names, nonempty deletion and empty head0"
    )
    fixture = (ROOT / "testing/benchmark/generated/mixed-runs.tedoc").read_bytes()
    ticket = upload(alice, did, fixture, 0)
    key = str(uuid.uuid4())
    saved = commit(alice, did, ticket, 0, key)
    assert saved["version"]["revision"] == 1
    retry = commit(alice, did, ticket, 0, key)
    assert retry == saved
    call(
        alice,
        "POST",
        f"/api/v1/documents/{did}/versions",
        409,
        json={"uploadId": str(uuid.uuid4()), "expectedHeadRevision": 0},
        headers={"Idempotency-Key": key},
    )
    data = call(alice, "GET", f"/api/v1/documents/{did}/versions/1/content").content
    assert data == fixture
    note(
        "Native text/styles save/reopen byte-exact, same-key retry and different-body rejection"
    )
    corrupt = fixture[:-10]
    bad = upload(alice, did, corrupt, 1)
    commit(alice, did, bad, 1, expected=422)
    assert call(alice, "GET", f"/api/v1/documents/{did}")["headRevision"] == 1
    note("Invalid native upload rejected without advancing cloud head")
    call(
        alice,
        "POST",
        f"/api/v1/documents/{did}/permissions",
        200,
        json={"email": ub["email"], "role": "VIEWER"},
    )
    assert any(
        d["id"] == did
        for d in call(bob, "GET", "/api/v1/documents?scope=SHARED")["items"]
    )
    call(bob, "GET", f"/api/v1/documents/{did}/versions/1/content")
    call(
        bob,
        "POST",
        f"/api/v1/documents/{did}/uploads",
        403,
        json={
            "expectedHeadRevision": 1,
            "nativeBytes": len(fixture),
            "nativeSha256": hashlib.sha256(fixture).hexdigest(),
        },
    )
    call(
        alice,
        "PUT",
        f'/api/v1/documents/{did}/permissions/{ub["id"]}',
        (200, 201),
        json={"role": "EDITOR"},
    )
    call(
        bob,
        "PATCH",
        f"/api/v1/documents/{did}",
        403,
        json={
            "expectedMetadataRevision": doc["metadataRevision"],
            "title": "forbidden",
        },
    )
    call(bob, "POST", f"/api/v1/documents/{did}/share-links", 403, json={})
    unicode_fixture = (
        ROOT / "testing/benchmark/generated/unicode-uniform.tedoc"
    ).read_bytes()
    t1 = upload(alice, did, unicode_fixture, 1)
    t2 = upload(bob, did, unicode_fixture, 1)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(
            pool.map(
                lambda a: commit(*a, expected=(200, 201, 409)),
                [(alice, did, t1, 1), (bob, did, t2, 1)],
            )
        )
    assert (
        sum("version" in r for r in outcomes) == 1
        and sum(r.get("code") == "REVISION_CONFLICT" for r in outcomes) == 1
    )
    pending = upload(bob, did, fixture, 2)
    call(alice, "DELETE", f'/api/v1/documents/{did}/permissions/{ub["id"]}', 204)
    commit(bob, did, pending, 2, expected=404)
    call(bob, "GET", f"/api/v1/documents/{did}", 404)
    note(
        "VIEWER/EDITOR authorization, concurrent conflict and revocation between upload/commit"
    )
    link = call(
        alice,
        "POST",
        f"/api/v1/documents/{did}/share-links",
        201,
        json={"expiresInSeconds": 3600},
    )
    path = "/api/v1/public/shares/" + link["token"]
    public = call(anon, "GET", path)
    assert set(public) == {
        "documentId",
        "title",
        "headRevision",
        "empty",
        "contentPath",
    }
    assert call(anon, "GET", public["contentPath"]).content == unicode_fixture
    call(
        alice,
        "DELETE",
        f'/api/v1/documents/{did}/share-links/{link["link"]["id"]}',
        204,
    )
    call(anon, "GET", path, 404)
    call(anon, "GET", "/api/v1/public/shares/" + "A" * 43, 404)
    note(
        "Anonymous read-only native viewer and revoked/invalid404 with no owner/folder disclosure"
    )
    for kind in ["EXPORT_TXT", "EXPORT_HTML"]:
        job = call(
            alice,
            "POST",
            "/api/v1/jobs",
            202,
            json={"documentId": did, "revision": 2, "type": kind},
            headers={"Idempotency-Key": str(uuid.uuid4())},
        )
        done = wait_job(alice, job["id"])
        assert done["state"] == "SUCCEEDED", done["errorCode"]
        download = call(alice, "GET", f'/api/v1/jobs/{job["id"]}/download')
        out = call(alice, "GET", download["url"]).content
        text = zipfile.ZipFile(io.BytesIO(unicode_fixture)).read("text.utf8").decode()
        if kind == "EXPORT_TXT":
            assert out.decode("utf-8-sig").replace("\r\n", "\n") == text
        else:
            assert b"<html" in out or b"<!DOCTYPE" in out or b"<pre" in out
    note(
        "Real Kafka-dispatched background TXT/HTML exports, authorized result streaming"
    )
    # Kafka outage must not gate a SQL save. Broker restart retains all topics/events.
    compose("stop", "kafka", capture_output=True)
    try:
        offline_ticket = upload(alice, did, fixture, 2)
        version = commit(alice, did, offline_ticket, 2)
        assert version["version"]["revision"] == 3
    finally:
        compose("start", "kafka", capture_output=True)
    note("Save commits successfully with Kafka stopped and durable outbox queued")
    for _ in range(80):
        current = call(alice, "GET", f"/api/v1/documents/{did}")
        if current.get("preview"):
            break
        time.sleep(0.5)
    else:
        raise AssertionError("Preview projection did not arrive")
    note("Preview resumes through Kafka outbox/inbox after broker returns")
    rev = current["metadataRevision"]
    call(
        alice,
        "DELETE",
        f"/api/v1/documents/{did}",
        204,
        json={"expectedMetadataRevision": rev},
    )
    call(
        alice,
        "DELETE",
        f'/api/v1/folders/{fid}?expectedMetadataRevision={folder["metadataRevision"]}',
        204,
    )
    # Existing local documents may fill several pages; verify the real trash
    # listing rather than assuming our disposable document is on page one.
    cursor, seen_cursors, trashdoc = None, set(), None
    for _ in range(100):
        params = {"scope": "TRASH"}
        if cursor is not None:
            params["cursor"] = cursor
        page = call(alice, "GET", "/api/v1/documents", params=params)
        trashdoc = next((d for d in page["items"] if d["id"] == did), None)
        if trashdoc is not None:
            break
        cursor = page.get("nextCursor")
        if not cursor:
            break
        assert cursor not in seen_cursors, "Trash pagination cursor repeated"
        seen_cursors.add(cursor)
    assert trashdoc is not None, "Document missing from paginated trash listing"
    restored = call(
        alice,
        "POST",
        f"/api/v1/documents/{did}/restore",
        json={"expectedMetadataRevision": trashdoc["metadataRevision"]},
    )
    assert restored["folderId"] is None
    note(
        "Trash detaches document and restoration falls back to root after folder deletion"
    )
    compose(
        "restart",
        "identity-service",
        "document-service",
        "processing-service",
        capture_output=True,
    )
    for _ in range(100):
        try:
            current = call(alice, "GET", f"/api/v1/documents/{did}")
            assert current["headRevision"] == 3
            break
        except (requests.RequestException, AssertionError):
            time.sleep(0.5)
    else:
        raise AssertionError("Services did not recover after restart")
    assert (
        call(alice, "GET", f"/api/v1/documents/{did}/versions/3/content").content
        == fixture
    )
    # Reload obtains a new CSRF token before rotating the surviving refresh cookie.
    csrf = call(alice, "GET", "/api/v1/auth/csrf")
    alice.headers[csrf["headerName"]] = csrf["token"]
    refreshed = call(alice, "POST", "/api/v1/auth/refresh")
    alice.headers["Authorization"] = "Bearer " + refreshed["accessToken"]
    call(alice, "POST", "/api/v1/auth/logout", 204)
    call(alice, "POST", "/api/v1/auth/refresh", 401)
    note(
        "Service restart preserves database/native objects/JWT key/refresh and logout revokes family"
    )
    (ROOT / "testing/reports/smoke.json").write_text(
        json.dumps(
            {
                "status": "PASS",
                "elapsedSeconds": round(time.time() - started, 2),
                "checks": checks,
                "scope": "real HTTP against Compose MySQL/Kafka/Redis/local storage with schema validation",
            },
            indent=2,
        ),
        encoding="utf-8",
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        (ROOT / "testing/reports/smoke.json").write_text(
            json.dumps(
                {"status": "FAIL", "completedChecks": checks, "error": str(error)},
                indent=2,
            ),
            encoding="utf-8",
        )
        raise
