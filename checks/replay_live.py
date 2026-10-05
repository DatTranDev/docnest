"""Replay a real durable Document event through authenticated Kafka and verify inbox deduplication."""

import json, pathlib, subprocess, sys, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from run import compose


def sql(user, statement):
    key = user.upper() + "_DB_PASSWORD"
    return compose(
        "exec",
        "-T",
        "mysql",
        "bash",
        "-c",
        f'MYSQL_PWD="${key}" mysql -u{user} -D{user}_db -N --raw -e "$1"',
        "replay-check",
        statement,
        capture_output=True,
        text=True,
    ).stdout.strip()


def offsets():
    result = compose(
        "exec",
        "-T",
        "kafka",
        "/opt/kafka/bin/kafka-get-offsets.sh",
        "--bootstrap-server",
        "localhost:9092",
        "--command-config",
        "/tmp/editor-kafka/admin.properties",
        "--topic",
        "document.version.saved.v1",
        capture_output=True,
        text=True,
    ).stdout
    return sum(
        int(line.rsplit(":", 1)[1])
        for line in result.splitlines()
        if line.startswith("document.version.saved.v1:")
    )


raw = sql(
    "document",
    "SELECT payload FROM outbox_events WHERE topic='document.version.saved.v1' AND published_at IS NOT NULL ORDER BY id DESC LIMIT 1",
)
event = json.loads(raw)
eventId = event["eventId"]
doc = event["payload"]["documentId"]
revision = event["payload"]["revision"]
receipt = f"SELECT COUNT(*) FROM inbox_receipts WHERE event_id='{eventId}'"
jobs = f"SELECT COUNT(*) FROM jobs WHERE document_id='{doc}' AND document_revision={revision} AND job_type='PREVIEW'"
deadline = time.monotonic() + 30
while sql("processing", receipt) != "1" and time.monotonic() < deadline:
    time.sleep(0.5)
assert (
    sql("processing", receipt) == "1"
), "Original event must already have been handled"
before_jobs = sql("processing", jobs)
before_offsets = offsets()
path = ROOT / "reports/raw/replay-original.json"
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(raw, encoding="utf-8")
for flag in ["--dry-run", "--publish"]:
    result = subprocess.run(
        [
            sys.executable,
            "scripts/replay_event.py",
            "--topic",
            "document.version.saved.v1",
            "--file",
            str(path),
            flag,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    summary = json.loads(result.stdout)
    assert summary["eventId"] == eventId
assert (
    offsets() == before_offsets + 1
), "Replay must append exactly one real Kafka record"
deadline = time.monotonic() + 30
consumed = False
while time.monotonic() < deadline:
    described = compose(
        "exec",
        "-T",
        "kafka",
        "/opt/kafka/bin/kafka-consumer-groups.sh",
        "--bootstrap-server",
        "localhost:9092",
        "--command-config",
        "/tmp/editor-kafka/admin.properties",
        "--describe",
        "--group",
        "processing-preview-v1",
        capture_output=True,
        text=True,
    ).stdout
    rows = [
        line.split()
        for line in described.splitlines()
        if "document.version.saved.v1" in line
    ]
    consumed = bool(rows) and all(row[5] == "0" for row in rows)
    if consumed:
        break
    time.sleep(0.5)
assert consumed, "Replay must be acknowledged by the real consumer"
assert sql("processing", receipt) == "1"
assert sql("processing", jobs) == before_jobs
(ROOT / "reports/replay-live.json").write_text(
    json.dumps(
        {
            "status": "PASS",
            "eventIdRetained": True,
            "brokerAppendCount": 1,
            "consumerLagZero": True,
            "inboxReceiptCount": 1,
            "previewJobCountUnchanged": True,
        },
        indent=2,
    )
)
print(
    "PASS actual authenticated replay: stable eventId, broker append, consumer ACK and no duplicate mutation"
)
