"""Real encrypted online snapshot/PITR drill in owned MySQL, with live DML and DDL fencing.

Reads a local app SQL snapshot; never stops or restores the user's application.
The mutable source and restore target are isolated, random, owned containers.
"""

import argparse
from contextlib import ExitStack
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tooling/scripts"))
from cloud_backup import DBS
from mysql_sandbox import Sandbox, build_tools
from online_backup import Source, archive_binlogs, capture, prerequisites, run, snapshot
from online_restore import decrypted, replay, replay_chain, validate_snapshot


def periodic_chain(source, options, logs, folder, key, age):
    def commit():
        source.query(
            "START TRANSACTION; UPDATE document_db.recovery_probe SET value=value+1; "
            "UPDATE processing_db.recovery_probe SET value=value+1; COMMIT;"
        )

    commit()
    options.output = folder / "later-snapshot.age"
    capture(options)
    previous = json.loads(logs.output.with_suffix(".age.receipt.json").read_text())
    archives = []
    for value in (4, 5):
        commit()
        batch = SimpleNamespace(**vars(logs))
        batch.start_file = previous["nextBoundary"]["file"]
        batch.start_position = previous["nextBoundary"]["position"]
        batch.output = folder / ("binlogs-" + str(value) + ".age")
        archive_binlogs(batch)
        archives.append(batch.output)
        previous = json.loads(batch.output.with_suffix(".age.receipt.json").read_text())
    with ExitStack() as stack:
        data, snapshot_manifest = stack.enter_context(
            decrypted(options.output, key, age)
        )
        validate_snapshot(data, snapshot_manifest)
        batches = [
            stack.enter_context(decrypted(archive, key, age)) for archive in archives
        ]
        assert batches[0][1]["logs"][0]["startPosition"] == 4
        assert snapshot_manifest["binlogBoundary"]["position"] > 4
        assert (
            batches[0][1]["logs"][0]["file"]
            == snapshot_manifest["binlogBoundary"]["file"]
        )
        with Sandbox(tools=True) as restored:
            restored.restore(data / "databases.sql")
            for owner in ("document_db", "processing_db"):
                assert restored.query(
                    owner, "SELECT JSON_OBJECT('value',value) FROM recovery_probe;"
                ) == [{"value": 3}]
            assert replay_chain(restored, batches, snapshot_manifest) == 2
            for owner in ("document_db", "processing_db"):
                assert restored.query(
                    owner, "SELECT JSON_OBJECT('value',value) FROM recovery_probe;"
                ) == [{"value": 5}]
            for invalid in (batches[::-1], batches[1:], [batches[0], batches[0]]):
                try:
                    replay_chain(restored, invalid, snapshot_manifest)
                except ValueError:
                    pass
                else:
                    raise AssertionError("Invalid periodic archive chain accepted")
            assert restored.query(
                "document_db", "SELECT JSON_OBJECT('value',value) FROM recovery_probe;"
            ) == [{"value": 5}]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-container", default="text-editor-mysql-1")
    parser.add_argument("--age", default="age")
    parser.add_argument("--age-keygen", default="age-keygen")
    args = parser.parse_args()
    started = time.monotonic()
    checks = []
    build_tools()
    with tempfile.TemporaryDirectory(prefix="docsnest-online-drill-") as temporary:
        folder = Path(temporary)
        key = folder / "identity.txt"
        run([args.age_keygen, "-o", str(key)])
        recipient = run([args.age_keygen, "-y", str(key)]).decode().strip()
        baseline = folder / "baseline"
        baseline.mkdir()
        snapshot(Source(local_container=args.source_container), baseline)
        with Sandbox(binlog=True, tools=True) as owned:
            owned.restore(baseline / "databases.sql")
            source = Source(local_container=owned.name)
            source.query(
                "CREATE TABLE document_db.recovery_probe(id INT PRIMARY KEY,value INT NOT NULL) ENGINE=InnoDB; CREATE TABLE processing_db.recovery_probe(id INT PRIMARY KEY,value INT NOT NULL) ENGINE=InnoDB; INSERT INTO document_db.recovery_probe VALUES(1,0); INSERT INTO processing_db.recovery_probe VALUES(1,0);"
            )
            with source.ddl_fence():
                source.query(
                    "START TRANSACTION; UPDATE document_db.recovery_probe SET value=1; UPDATE processing_db.recovery_probe SET value=1; COMMIT;"
                )
                try:
                    source.query(
                        "SET SESSION lock_wait_timeout=1; ALTER TABLE document_db.recovery_probe ADD COLUMN blocked INT;"
                    )
                except ValueError:
                    checks.append(
                        "DDL fence blocks schema change while DML continues and commits"
                    )
                else:
                    raise AssertionError("DDL was not fenced")
            options = SimpleNamespace(
                mysql_defaults=None,
                local_container=owned.name,
                output=folder / "snapshot.age",
                recipient=recipient,
                age=args.age,
                project=None,
                jwt_secret_version=None,
                context=None,
                images=None,
                destination=None,
            )
            capture(options)
            checks.append(
                "Encrypted single-transaction snapshot of all five databases restored in isolated MySQL"
            )
            source.query(
                "START TRANSACTION; UPDATE document_db.recovery_probe SET value=2; UPDATE processing_db.recovery_probe SET value=2; COMMIT;"
            )
            with decrypted(options.output, key, args.age) as (data, manifest):
                validate_snapshot(data, manifest)
                boundary = manifest["binlogBoundary"]
                logs = SimpleNamespace(
                    mysql_defaults=None,
                    local_container=owned.name,
                    start_file=boundary["file"],
                    start_position=boundary["position"],
                    server_uuid=prerequisites(source)["serverUuid"],
                    output=folder / "binlogs.age",
                    recipient=recipient,
                    age=args.age,
                    project=None,
                    destination=None,
                )
                archive_binlogs(logs)
                with Sandbox(tools=True) as restored:
                    restored.restore(data / "databases.sql")
                    for database in DBS:
                        assert (
                            restored.query(
                                database,
                                "SELECT JSON_OBJECT('tables',COUNT(*)) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE();",
                            )[0]["tables"]
                            > 0
                        )
                    assert restored.query(
                        "document_db",
                        "SELECT JSON_OBJECT('value',value) FROM recovery_probe;",
                    ) == [{"value": 1}]
                    assert restored.query(
                        "processing_db",
                        "SELECT JSON_OBJECT('value',value) FROM recovery_probe;",
                    ) == [{"value": 1}]
                    with decrypted(logs.output, key, args.age) as (
                        log_data,
                        log_manifest,
                    ):
                        replay(restored, log_data, log_manifest, manifest)
                        assert restored.query(
                            "document_db",
                            "SELECT JSON_OBJECT('value',value) FROM recovery_probe;",
                        ) == [{"value": 2}]
                        assert restored.query(
                            "processing_db",
                            "SELECT JSON_OBJECT('value',value) FROM recovery_probe;",
                        ) == [{"value": 2}]
                        log_manifest["serverUuid"] = "wrong-source"
                        try:
                            replay(restored, log_data, log_manifest, manifest)
                        except ValueError:
                            checks.append("Cross-server PITR chain rejected")
                        else:
                            raise AssertionError("Wrong source accepted")
                checks.append(
                    "Actual ROW binlog replay recovers the post-snapshot cross-database transaction"
                )
            periodic_chain(source, options, logs, folder, key, args.age)
            checks.append(
                "Later hourly snapshot restores from its interior binlog position through two consecutive periodic archives; reordered, missing and overlapping batches rejected"
            )
            raw = bytearray(options.output.read_bytes())
            raw[-5] ^= 1
            broken = folder / "tampered.age"
            broken.write_bytes(raw)
            try:
                with decrypted(broken, key, args.age):
                    raise AssertionError("Tampered ciphertext accepted")
            except ValueError:
                checks.append("Tampered encrypted archive rejected before SQL restore")
    report = {
        "status": "PASS",
        "checks": checks,
        "sqlDrillSeconds": round(time.monotonic() - started, 2),
        "scope": "Actual local SQL and encryption only; no existing application restart/restore",
        "applicationRestore": "NOT_RUN",
        "gcsRestore": "NOT_RUN",
        "applicationRpoRto": "NOT_MEASURED",
    }
    (ROOT / "testing/reports/online-recovery.json").write_text(
        json.dumps(report, indent=2) + "\n"
    )
    print(
        "PASS real encrypted online SQL/PITR drill; five owners, concurrent writes and DDL fencing"
    )


if __name__ == "__main__":
    main()
