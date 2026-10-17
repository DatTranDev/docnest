"""Real encrypted online snapshot/PITR drill in owned MySQL, with live DML and DDL fencing.

Reads a local app SQL snapshot; never stops or restores the user's application.
The mutable source and restore target are isolated, random, owned containers.
"""

import argparse
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
from online_restore import decrypted, replay, validate_snapshot


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
