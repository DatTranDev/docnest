"""Independent online five-database snapshots and closed-binlog archives.

Capture holds a MySQL BACKUP_ADMIN DDL fence, never stops application writers.
References are read from the restored SQL snapshot, never from racing live queries.
Only age-encrypted archives leave the private temporary directory. GKE operations
require explicit operator configuration; the deployment workflow never invokes this.
"""

import argparse
import base64
from contextlib import contextmanager
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import subprocess
import tarfile
import tempfile
import threading
import time
import uuid

from cloud_backup import (
    DBS,
    capture_records,
    fingerprint,
    protected_json,
    ref_identity,
    refs_in,
)
from mysql_sandbox import Sandbox
from digest_manifest import NAMES, validate_manifest

ROOT = Path(__file__).resolve().parents[2]


def run(args, *, output=None, data=None):
    try:
        result = subprocess.run(
            args,
            input=data,
            stdout=output or subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=1800,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise ValueError(
            "Online backup command unavailable or timed out; protected output withheld"
        ) from None
    if result.returncode:
        raise ValueError("Online backup command failed; protected output withheld")
    return result.stdout


class Source:
    def __init__(self, defaults=None, local_container=None):
        if bool(defaults) == bool(local_container):
            raise ValueError("Choose exactly one explicit MySQL connection")
        if local_container and not re.fullmatch(
            r"[A-Za-z0-9][A-Za-z0-9_.-]{1,100}", local_container
        ):
            raise ValueError("Invalid local MySQL container")
        self.defaults = Path(defaults).resolve() if defaults else None
        self.container = local_container

    def command(self, tool, options=()):
        if tool not in ("mysql", "mysqldump", "mysqlbinlog"):
            raise ValueError("Non-backup MySQL tool rejected")
        if self.container:
            # Root is permitted only for an explicitly selected local Docker lab.
            import shlex

            return [
                "docker",
                "exec",
                "-i",
                self.container,
                "bash",
                "-c",
                'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec '
                + shlex.join([tool, "--user=root", *options]),
            ]
        return [tool, "--defaults-extra-file=" + str(self.defaults), *options]

    def query(self, sql):
        result = run(
            self.command(
                "mysql", ["--batch", "--raw", "--unbuffered", "--skip-column-names"]
            ),
            data=sql.encode(),
        )
        return [json.loads(row) for row in result.decode().splitlines() if row]

    @contextmanager
    def ddl_fence(self):
        process = subprocess.Popen(
            self.command(
                "mysql",
                ["--batch", "--unbuffered", "--skip-column-names", "--skip-reconnect"],
            ),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        acknowledgement = queue.Queue()
        threading.Thread(
            target=lambda: acknowledgement.put(process.stdout.readline()), daemon=True
        ).start()
        try:
            process.stdin.write(
                b"SET SESSION lock_wait_timeout=30, wait_timeout=600; LOCK INSTANCE FOR BACKUP; SELECT CONCAT('BACKUP_READY:',CONNECTION_ID());\n"
            )
            process.stdin.flush()
            try:
                ready = acknowledgement.get(timeout=35)
            except queue.Empty:
                raise ValueError("MySQL DDL backup fence timed out") from None
            match = re.fullmatch(rb"BACKUP_READY:([0-9]+)", ready.strip())
            if not match:
                raise ValueError("MySQL BACKUP_ADMIN DDL fence could not be acquired")
            yield
            if process.poll() is not None:
                raise ValueError("MySQL DDL fence connection was lost")
            threading.Thread(
                target=lambda: acknowledgement.put(process.stdout.readline()),
                daemon=True,
            ).start()
            process.stdin.write(b"SELECT CONCAT('BACKUP_HELD:',CONNECTION_ID());\n")
            process.stdin.flush()
            try:
                held = acknowledgement.get(timeout=35).strip()
            except queue.Empty:
                raise ValueError("MySQL DDL fence could not be revalidated") from None
            if held != b"BACKUP_HELD:" + match[1]:
                raise ValueError("MySQL DDL fence session changed")
        finally:
            if process.poll() is None:
                try:
                    process.stdin.write(b"UNLOCK INSTANCE;\n")
                    process.stdin.close()
                    process.wait(timeout=15)
                except (BrokenPipeError, subprocess.TimeoutExpired):
                    process.kill()
                    process.wait(timeout=15)


def prerequisites(source):
    values = source.query(
        "SELECT JSON_OBJECT('logBin',@@log_bin,'format',@@binlog_format,'serverUuid',@@server_uuid,'expires',@@binlog_expire_logs_seconds,'version',VERSION());"
    )[0]
    if (
        values["logBin"] != 1
        or values["format"] != "ROW"
        or values["expires"] < 7 * 86400
        or not re.fullmatch(r"8\.4\.7(?:[-+].*)?", values["version"])
    ):
        raise ValueError(
            "Require the pinned MySQL8.4.7 tools/server, ROW binlogs and seven days local retention"
        )
    engines = source.query(
        "SELECT JSON_OBJECT('engine',ENGINE) FROM information_schema.TABLES WHERE TABLE_SCHEMA IN ('identity_db','document_db','processing_db','collaboration_db','payment_db') AND TABLE_TYPE='BASE TABLE';"
    )
    if not engines or any(row["engine"] != "InnoDB" for row in engines):
        raise ValueError(
            "Single-transaction recovery requires all five owners to use InnoDB"
        )
    return values


def coordinates(path):
    matches = []
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            match = re.fullmatch(
                r"-- CHANGE REPLICATION SOURCE TO SOURCE_LOG_FILE='([A-Za-z0-9_.-]+)', SOURCE_LOG_POS=([0-9]+);\n?",
                line,
            )
            if match:
                matches.append({"file": match[1], "position": int(match[2])})
    if len(matches) != 1 or matches[0]["position"] < 4:
        raise ValueError("Snapshot is missing its exact binlog recovery boundary")
    return matches[0]


def snapshot(source, directory):
    with source.ddl_fence():
        with (directory / "databases.sql").open("wb") as stream:
            run(
                source.command(
                    "mysqldump",
                    [
                        "--default-character-set=utf8mb4",
                        "--hex-blob",
                        "--single-transaction",
                        "--source-data=2",
                        "--no-tablespaces",
                        "--routines",
                        "--events",
                        "--set-gtid-purged=OFF",
                        "--databases",
                        *DBS,
                    ],
                ),
                output=stream,
            )
    return coordinates(directory / "databases.sql")


def snapshot_metadata(sandbox):
    histories = {
        database: sandbox.query(
            database,
            "SELECT JSON_OBJECT('version',version,'checksum',checksum,'success',success) FROM flyway_schema_history WHERE version IS NOT NULL ORDER BY installed_rank;",
        )
        for database in DBS
    }
    counts = {
        database: sandbox.query(
            database,
            "SELECT JSON_OBJECT('tables',COUNT(*)) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE();",
        )[0]["tables"]
        for database in DBS
    }
    return {"flyway": histories, "databaseTableCounts": counts}


def capture_objects(sandbox, directory, project):
    records = capture_records(sandbox)
    required = {}
    for record in records:
        if record["required"]:
            for ref in refs_in(record["value"]):
                required[ref_identity(ref)] = ref
    hashes = {
        ref_identity(row["ref"]): row["sha256"]
        for row in sandbox.query(
            "document_db",
            "SELECT JSON_OBJECT('ref',JSON_OBJECT('provider',storage_provider,'bucket',storage_bucket,'key',object_key,'generation',object_generation),'sha256',native_sha256) FROM document_versions WHERE object_deleted_at IS NULL;",
        )
    }
    (directory / "objects").mkdir()
    entries = []
    for identity, ref in sorted(required.items()):
        name = hashlib.sha256(json.dumps(identity).encode()).hexdigest() + ".bin"
        target = directory / "objects" / name
        run(
            [
                "gcloud",
                "storage",
                "cp",
                "--project",
                project,
                "gs://" + ref["bucket"] + "/" + ref["key"] + "#" + ref["generation"],
                str(target),
            ]
        )
        digest = fingerprint(target)
        if identity in hashes and digest != hashes[identity]:
            raise ValueError(
                "Committed immutable object hash mismatch; online backup rejected"
            )
        entries.append(
            {"ref": ref, "file": name, "sha256": digest, "bytes": target.stat().st_size}
        )
    return {"objects": entries, "records": records}


def encrypt(directory, destination, recipient, age):
    if not re.fullmatch(r"age1[0-9a-z]{58}", recipient):
        raise ValueError("Supply the reviewed age recipient, never a private identity")
    if destination.exists():
        raise ValueError("Encrypted recovery archives are immutable")
    archive = directory.parent / "recovery.tar"
    with tarfile.open(archive, "w") as bundle:
        for path in sorted(directory.rglob("*")):
            if path.is_file():
                bundle.add(path, arcname=path.relative_to(directory), recursive=False)
    run(
        [
            age,
            "--encrypt",
            "--recipient",
            recipient,
            "--output",
            str(destination),
            str(archive),
        ]
    )
    return fingerprint(destination)


def capture(args):
    source = Source(args.mysql_defaults, args.local_container)
    started = time.monotonic()
    created = dt.datetime.now(dt.timezone.utc).isoformat()
    variables = prerequisites(source)
    if not args.local_container and variables["serverUuid"] != getattr(
        args, "server_uuid", None
    ):
        raise ValueError(
            "MySQL server UUID does not match the reviewed cluster database"
        )
    with tempfile.TemporaryDirectory(prefix="docsnest-online-backup-") as temporary:
        directory = Path(temporary) / "capture"
        directory.mkdir(mode=0o700)
        cloud_images = None
        if not args.local_container:
            cloud_images = capture_cloud_images(args)
            capture_key(args, directory)
        boundary = snapshot(source, directory)
        with Sandbox() as sandbox:
            sandbox.restore(directory / "databases.sql")
            metadata = snapshot_metadata(sandbox)
            if args.local_container:
                # Lab SQL round-trip is deliberately not cloud-object recovery proof.
                objects = {
                    "objects": [],
                    "records": [],
                    "objectRecovery": "NOT_RUN; SQL-only lab capture",
                }
                if getattr(args, "local_document_container", None) and getattr(
                    args, "local_identity_container", None
                ):
                    from local_backup_objects import capture as local_objects

                    objects = local_objects(
                        sandbox,
                        directory,
                        args.local_document_container,
                        args.local_identity_container,
                    )
            else:
                if (
                    not args.project
                    or not args.jwt_secret_version
                    or not args.context
                    or not args.images
                ):
                    raise ValueError(
                        "Cloud backup requires project, numeric JWT version, context and approved images"
                    )
                objects = capture_objects(sandbox, directory, args.project)
                capture_key(args, directory)
        manifest = {
            "format": 2,
            "kind": "online-snapshot",
            "createdAt": created,
            "quiesced": False,
            "databases": list(DBS),
            "source": variables,
            "binlogBoundary": boundary,
            "sqlSha256": fingerprint(directory / "databases.sql"),
            "durationSeconds": round(time.monotonic() - started, 2),
            "consistency": "Single InnoDB transaction across five databases; DDL fenced. Kafka offsets are not a cross-system commit boundary.",
            "replay": "Restore SQL inbox/outbox and jobs together. Reconcile Kafka retained delivery and provider receipts before replay; external effects are never undone.",
            "cloudRestore": "NOT_RUN",
            **metadata,
            **objects,
        }
        if args.images:
            manifest["images"] = json.loads(args.images.read_text(encoding="utf-8"))
        if cloud_images is not None:
            if capture_cloud_images(args) != cloud_images:
                raise ValueError(
                    "Application state changed during capture; retry a stable online point"
                )
            manifest.update(
                project=args.project,
                jwtSecretVersion=args.jwt_secret_version,
                keySha256=fingerprint(directory / "identity-key.pem"),
            )
        protected_json(directory / "manifest.json", manifest)
        digest = encrypt(directory, args.output, args.recipient, args.age)
    publish(
        args, digest, {"serverUuid": variables["serverUuid"], "nextBoundary": boundary}
    )
    print(
        "PASS encrypted online snapshot; SQL restored in isolated MySQL; full application/GCS restore remains a separate gate"
    )


def capture_cloud_images(args):
    if not all(
        (
            args.project,
            getattr(args, "region", None),
            args.context,
            args.images,
            args.jwt_secret_version,
        )
    ):
        raise ValueError(
            "Cloud snapshot requires project/region/context/images and numeric JWT version"
        )
    expected = json.loads(args.images.read_text(encoding="utf-8"))
    validate_manifest(expected, args.project, args.region)
    templates = {}
    for name in NAMES:
        obj = json.loads(
            run(
                [
                    "kubectl",
                    "--context",
                    args.context,
                    "-n",
                    "editor-lab",
                    "get",
                    "deployment",
                    name,
                    "-o",
                    "json",
                ]
            )
        )
        spec, status = obj["spec"], obj.get("status", {})
        desired = spec.get("replicas", 1)
        if (
            desired < 1
            or status.get("readyReplicas") != desired
            or status.get("updatedReplicas") != desired
            or status.get("replicas") != desired
            or spec["template"]["spec"]["containers"][0]["image"] != expected[name]
        ):
            raise ValueError(
                "Online capture requires the approved stable six-image state"
            )
        templates[name] = {
            "uid": obj["metadata"]["uid"],
            "template": hashlib.sha256(
                json.dumps(spec["template"], sort_keys=True).encode()
            ).hexdigest(),
        }
    return templates


def capture_key(args, directory):
    match = re.fullmatch(
        r"projects/([a-z][a-z0-9-]+)/secrets/editor-jwt/versions/([1-9][0-9]*)",
        args.jwt_secret_version,
    )
    if not match or match[1] != args.project:
        raise ValueError(
            "JWT must pin a numeric Secret Manager version in this project"
        )
    key = directory / "identity-key.pem"
    with key.open("wb") as stream:
        run(
            [
                "gcloud",
                "secrets",
                "versions",
                "access",
                match[2],
                "--secret=editor-jwt",
                "--project",
                args.project,
            ],
            output=stream,
        )
    live = json.loads(
        run(
            [
                "kubectl",
                "--context",
                args.context,
                "-n",
                "editor-lab",
                "get",
                "secret",
                "editor-jwt",
                "-o",
                "json",
            ]
        )
    )
    if hashlib.sha256(
        base64.b64decode(live["data"]["identity-key.pem"], validate=True)
    ).hexdigest() != fingerprint(key):
        raise ValueError("JWT version does not match the mounted key")
    protected_json(
        directory / "key-reference.json",
        {"jwtSecretVersion": args.jwt_secret_version, "keySha256": fingerprint(key)},
    )


def publish(args, digest, metadata=None):
    if args.destination:
        if (
            not args.project
            or not re.fullmatch(
                r"gs://[a-z0-9][a-z0-9._-]+/recovery/[A-Za-z0-9_./-]+\.age",
                args.destination,
            )
            or ".." in args.destination
        ):
            raise ValueError("Use an immutable reviewed recovery bucket/key")
        run(
            [
                "gcloud",
                "storage",
                "cp",
                "--project",
                args.project,
                "--if-generation-match=0",
                str(args.output),
                args.destination,
            ]
        )
    report = {
        "status": "CAPTURED",
        "ciphertextSha256": digest,
        "applicationRestore": "NOT_RUN",
        "capturedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        **(metadata or {}),
    }
    args.output.with_suffix(args.output.suffix + ".receipt.json").write_text(
        json.dumps(report, indent=2) + "\n"
    )


def archive_binlogs(args):
    source = Source(args.mysql_defaults, args.local_container)
    variables = prerequisites(source)
    if (
        not args.start_file
        or not re.fullmatch(r"[A-Za-z0-9_-]+\.[0-9]{6}", args.start_file)
        or args.start_position < 4
        or args.server_uuid != variables["serverUuid"]
    ):
        raise ValueError(
            "Supply the snapshot's exact server UUID and retained binlog boundary"
        )
    source.query("FLUSH BINARY LOGS;")
    raw = run(
        source.command(
            "mysql", ["--batch", "--skip-column-names", "--execute=SHOW BINARY LOGS"]
        )
    )
    names = [line.split("\t")[0] for line in raw.decode().splitlines()]
    if args.start_file not in names[:-1]:
        raise ValueError("Required binlog already purged; PITR archive gap")
    selected = names[names.index(args.start_file) : -1]
    if any(
        not re.fullmatch(r"[A-Za-z0-9_-]+\.[0-9]{6}", name)
        or name.rsplit(".", 1)[0] != args.start_file.rsplit(".", 1)[0]
        for name in selected
    ):
        raise ValueError("Binary log file name or prefix rejected")
    sequence = [int(name.rsplit(".", 1)[1]) for name in selected]
    if sequence != list(range(sequence[0], sequence[0] + len(sequence))):
        raise ValueError("Binary log sequence has a gap")
    with tempfile.TemporaryDirectory(prefix="docsnest-binlogs-") as temporary:
        directory = Path(temporary) / "capture"
        directory.mkdir(mode=0o700)
        entries = []
        for index, name in enumerate(selected):
            position = args.start_position if index == 0 else 4
            target = directory / name
            options = ["--read-from-remote-server", "--raw", "--verify-binlog-checksum"]
            if args.local_container:
                remote = "/tmp/docsnest-binlog-" + uuid.uuid4().hex + "/"
                run(["docker", "exec", args.local_container, "mkdir", remote])
                try:
                    run(
                        source.command(
                            "mysqlbinlog",
                            [
                                *options,
                                "--host=127.0.0.1",
                                "--result-file=" + remote,
                                name,
                            ],
                        )
                    )
                    run(
                        [
                            "docker",
                            "cp",
                            args.local_container + ":" + remote + name,
                            str(target),
                        ]
                    )
                finally:
                    run(
                        [
                            "docker",
                            "exec",
                            args.local_container,
                            "rm",
                            "-rf",
                            "--",
                            remote,
                        ]
                    )
            else:
                run(
                    source.command(
                        "mysqlbinlog",
                        [*options, "--result-file=" + str(directory) + os.sep, name],
                    )
                )
            entries.append(
                {
                    "file": target.name,
                    "sourceFile": name,
                    "startPosition": position,
                    "sha256": fingerprint(target),
                }
            )
        protected_json(
            directory / "manifest.json",
            {
                "format": 2,
                "kind": "closed-binlogs",
                "serverUuid": args.server_uuid,
                "logs": entries,
                "nextBoundary": {"file": names[-1], "position": 4},
                "applicationPitr": "NOT_VERIFIED; required object generations and external side effects must also be reconciled",
            },
        )
        digest = encrypt(directory, args.output, args.recipient, args.age)
    publish(
        args,
        digest,
        {
            "serverUuid": args.server_uuid,
            "nextBoundary": {"file": names[-1], "position": 4},
        },
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["capture", "archive-binlogs"])
    parser.add_argument("--mysql-defaults", type=Path)
    parser.add_argument("--local-container")
    parser.add_argument("--local-document-container")
    parser.add_argument("--local-identity-container")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--recipient", required=True)
    parser.add_argument("--age", default="age")
    parser.add_argument("--destination")
    parser.add_argument("--project")
    parser.add_argument("--region")
    parser.add_argument("--context")
    parser.add_argument("--images", type=Path)
    parser.add_argument("--jwt-secret-version")
    parser.add_argument("--start-file")
    parser.add_argument("--start-position", type=int, default=4)
    parser.add_argument("--server-uuid")
    args = parser.parse_args()
    if not args.output.parent.is_dir():
        raise ValueError("Create and protect the ciphertext output directory first")
    if args.action == "capture":
        capture(args)
    else:
        archive_binlogs(args)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Libraries/CLIs can include signed URLs and private SQL in exceptions.
        raise SystemExit(
            "Online recovery operation failed; no recovery point is approved. Check prerequisites and bounded receipts."
        ) from None
