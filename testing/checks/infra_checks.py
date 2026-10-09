"""P01 actual database ownership, Flyway idempotence and volume restart checks."""

import sys, pathlib, json, subprocess, time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "tooling/scripts"))
from run import compose, initialize, ROOT

values = initialize()


def sql(user, db, statement, success=True):
    key = f"{user.upper()}_DB_PASSWORD"
    # Use the container's existing env to keep credentials out of argv/logs.
    r = compose(
        "exec",
        "-T",
        "mysql",
        "bash",
        "-c",
        f'MYSQL_PWD="${key}" mysql -u{user} -D{db} -N -e "$1"',
        "sql-check",
        statement,
        capture_output=True,
        text=True,
    )
    return r.stdout.strip()


checks = []
owners = ("identity", "document", "processing", "collaboration", "payment")
for user in owners:
    own = user + "_db"
    sql(user, own, "SELECT DATABASE()")
    checks.append(user + " own DB accessible")
    for other in owners:
        if other == user:
            continue
        try:
            sql(
                user, own, f"SELECT COUNT(*) FROM {other}_db.information_schema_missing"
            )
        except subprocess.CalledProcessError as e:
            if "denied" not in e.stderr.lower():
                raise
            checks.append(f"{user} denied {other}_db")
        else:
            raise AssertionError("Cross-database query unexpectedly allowed")
before = {
    u: sql(
        u,
        u + "_db",
        "SELECT installed_rank,version,checksum,success FROM flyway_schema_history ORDER BY installed_rank",
    )
    for u in owners
}
compose("restart", "mysql", "kafka")
for _ in range(60):
    try:
        sql("identity", "identity_db", "SELECT 1")
        break
    except subprocess.CalledProcessError:
        time.sleep(1)
else:
    raise AssertionError("MySQL failed restart")
compose("restart", *(user + "-service" for user in owners))
time.sleep(10)
after = {
    u: sql(
        u,
        u + "_db",
        "SELECT installed_rank,version,checksum,success FROM flyway_schema_history ORDER BY installed_rank",
    )
    for u in before
}
assert before == after, "Flyway reapplied or changed migration on restart"
checks += [
    "SQL volume survived restart",
    "Flyway history unchanged after service restart",
]
listing = compose(
    "exec",
    "-T",
    "kafka",
    "/opt/kafka/bin/kafka-topics.sh",
    "--bootstrap-server",
    "localhost:9092",
    "--command-config",
    "/tmp/editor-kafka/admin.properties",
    "--list",
    capture_output=True,
    text=True,
).stdout
assert "document.version.saved.v1" in listing
checks += ["Kafka topics survived restart"]
(ROOT / "testing/reports/infrastructure.json").write_text(
    json.dumps({"status": "PASS", "checks": checks, "flyway": after}, indent=2),
    encoding="utf-8",
)
print(json.dumps(checks))
