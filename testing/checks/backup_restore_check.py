"""Real, explicitly scoped restore drill on this task's synthetic local application data.

Requires the running local lab populated by smoke. Backs up before creating a disposable
marker, then uses the documented restore command and verifies immutable bytes and keys.
Do not run against a user-populated production environment.
"""

import hashlib, json, pathlib, subprocess, sys, time, uuid
import requests

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tooling/scripts"))
from run import compose, initialize

values = initialize()
base = "http://localhost:8080"
session = requests.Session()
session.headers["Origin"] = base
csrf = session.get(base + "/api/v1/auth/csrf", timeout=10).json()
session.headers[csrf["headerName"]] = csrf["token"]
email = "smoke-owner@editor.test"
password = hashlib.sha256((values["MYSQL_ROOT_PASSWORD"] + email).encode()).hexdigest()[
    :32
]
login = session.post(
    base + "/api/v1/auth/login", json={"email": email, "password": password}, timeout=15
)
login.raise_for_status()
session.headers["Authorization"] = "Bearer " + login.json()["accessToken"]


def sql(user, query):
    key = user.upper() + "_DB_PASSWORD"
    return compose(
        "exec",
        "-T",
        "mysql",
        "bash",
        "-c",
        f'MYSQL_PWD="${key}" mysql -u{user} -D{user}_db -N --raw -e "$1"',
        "restore-check",
        query,
        capture_output=True,
        text=True,
    ).stdout.strip()


def counts():
    return {
        user: {
            table: sql(user, "SELECT COUNT(*) FROM " + table)
            for table in tables
            + (
                []
                if user == "payment"
                else ["subscription_entitlements", "saga_inbox", "saga_outbox"]
            )
        }
        for user, tables in {
            "identity": ["users"],
            "document": ["documents", "folders", "document_versions"],
            "processing": ["jobs"],
            "collaboration": ["collaboration_rooms", "collaboration_updates"],
            "payment": [
                "payment_accounts",
                "payment_requests",
                "payment_sagas",
                "stripe_receipts",
                "saga_inbox",
                "saga_outbox",
            ],
        }.items()
    }


row = sql(
    "document",
    "SELECT document_id,revision FROM document_versions ORDER BY created_at DESC LIMIT 1",
).split("\t")
doc, revision = row
path = f"/api/v1/documents/{doc}/versions/{revision}/content"
# The newest UI owner is a different account; choose a real smoke-owned large version.
owner = login.json()["user"]["id"]
row = sql(
    "document",
    f"SELECT v.document_id,v.revision,v.object_key FROM document_versions v JOIN documents d ON v.document_id=d.id WHERE d.owner_user_id='{owner}' AND d.deleted_at IS NULL ORDER BY v.created_at DESC LIMIT 1",
).split("\t")
doc, revision, object_key = row
path = f"/api/v1/documents/{doc}/versions/{revision}/content"
before = session.get(base + path, timeout=60)
before.raise_for_status()
native_hash = hashlib.sha256(before.content).hexdigest()
keys = session.get(base + "/.well-known/jwks.json", timeout=10).json()
before_counts = counts()
backup = ROOT / "testing/reports/raw/restore-drill"
# Existing destinations must receive contents, not nested objects/objects or keys/keys.
for name in ["objects", "keys"]:
    (backup / name).mkdir(parents=True, exist_ok=True)
subprocess.run(
    [sys.executable, "tooling/scripts/run.py", "backup", "--backup-path", str(backup)],
    check=True,
)
assert (backup / "databases.sql").stat().st_size > 1000
assert json.loads((backup / "manifest.json").read_text())["quiesced"] is True
assert (
    hashlib.sha256((backup / "objects" / object_key).read_bytes()).hexdigest()
    == native_hash
)
csrf = session.get(base + "/api/v1/auth/csrf", timeout=10).json()
session.headers[csrf["headerName"]] = csrf["token"]
marker = session.post(
    base + "/api/v1/documents",
    json={"title": "Restore drill disposable " + uuid.uuid4().hex, "folderId": None},
    timeout=10,
)
marker.raise_for_status()
markerId = marker.json()["id"]
assert (
    session.get(base + f"/api/v1/documents/{markerId}", timeout=10).status_code == 200
)
subprocess.run(
    [
        sys.executable,
        "tooling/scripts/run.py",
        "restore",
        "--backup-path",
        str(backup),
        "--confirm-restore",
    ],
    check=True,
)
deadline = time.monotonic() + 90
ready = False
while time.monotonic() < deadline:
    try:
        ready = session.get(base + "/api/v1/auth/me", timeout=5).status_code == 200
    except requests.RequestException:
        pass
    if ready:
        break
    time.sleep(0.5)
assert ready, "Restored application must be ready with its original signing key"
reopened = session.get(base + path, timeout=60)
reopened.raise_for_status()
assert hashlib.sha256(reopened.content).hexdigest() == native_hash
assert session.get(base + "/.well-known/jwks.json", timeout=10).json() == keys
assert (
    session.get(base + f"/api/v1/documents/{markerId}", timeout=10).status_code == 404
)
assert counts() == before_counts, "Logical data must return to the backup snapshot"
(ROOT / "testing/reports/backup-restore.json").write_text(
    json.dumps(
        {
            "status": "PASS",
            "scope": "task-created synthetic local lab only",
            "databasesRestored": 4,
            "originalCountsRestored": True,
            "postBackupMarkerRemoved": True,
            "immutableNativeHashPreserved": True,
            "signingKeyPreserved": True,
            "sqlBackupBytes": (backup / "databases.sql").stat().st_size,
            "objectsCopied": True,
            "cloudRestore": "NOT_RUN",
        },
        indent=2,
    ),
    encoding="utf-8",
)
print(
    "PASS real local backup/restore: five DBs, objects, original native bytes and JWT key; disposable post-backup marker removed"
)
