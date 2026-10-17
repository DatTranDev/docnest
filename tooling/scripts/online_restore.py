"""Decrypt, verify and restore an online snapshot/PITR chain into owned disposable MySQL.

Never imports into an existing database. Never contacts Stripe or replays Kafka.
SQL verification is distinct from the isolated application/GCS recovery acceptance.
"""

import argparse
from contextlib import contextmanager, ExitStack
import json
from pathlib import Path
import re
import shutil
import tarfile
import tempfile
import time

from cloud_backup import DBS, fingerprint, ref_identity
from mysql_sandbox import Sandbox
from online_backup import run, snapshot_metadata


@contextmanager
def decrypted(archive, identity, age="age"):
    with tempfile.TemporaryDirectory(prefix="docsnest-restore-") as temporary:
        root = Path(temporary)
        size = archive.stat().st_size
        if (
            size < 1
            or size > 64 * 1024**3
            or shutil.disk_usage(root).free < 2 * size + 128 * 1024**2
        ):
            raise ValueError("Recovery archive exceeds its disk budget")
        tar = root / "recovery.tar"
        run(
            [
                age,
                "--decrypt",
                "--identity",
                str(identity),
                "--output",
                str(tar),
                str(archive),
            ]
        )
        directory = root / "data"
        directory.mkdir(mode=0o700)
        with tarfile.open(tar) as bundle:
            members = bundle.getmembers()
            if (
                len(members) > 100000
                or sum(member.size for member in members) > 64 * 1024**3
                or sum(member.size for member in members) + 128 * 1024**2
                > shutil.disk_usage(root).free
            ):
                raise ValueError("Recovery archive exceeds limits")
            names = [member.name for member in members]
            if len(set(names)) != len(names) or any(
                not member.isfile()
                or member.sparse is not None
                or not re.fullmatch(
                    r"(?:manifest\.json|key-reference\.json|identity-key\.pem|databases\.sql|objects/[a-f0-9]{64}\.bin|[A-Za-z0-9_-]+\.[0-9]{6})",
                    member.name,
                )
                for member in members
            ):
                raise ValueError("Recovery archive member rejected")
            bundle.extractall(directory, members=members, filter="data")
        manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
        if manifest.get("format") != 2:
            raise ValueError("Expected online recovery format2")
        yield directory, manifest


def validate_snapshot(directory, manifest):
    if (
        manifest.get("kind") != "online-snapshot"
        or manifest.get("databases") != list(DBS)
        or manifest.get("quiesced") is not False
        or fingerprint(directory / "databases.sql") != manifest.get("sqlSha256")
    ):
        raise ValueError("Online snapshot scope or integrity mismatch")
    for entry in manifest["objects"]:
        if manifest.get("storageMode") == "LOCAL":
            from local_backup_objects import identity as local_identity

            local_identity(entry["ref"])
        else:
            ref_identity(entry["ref"])
        if not re.fullmatch(r"[a-f0-9]{64}\.bin", entry["file"]):
            raise ValueError("Object path rejected")
        target = directory / "objects" / entry["file"]
        if (
            target.stat().st_size != entry["bytes"]
            or fingerprint(target) != entry["sha256"]
        ):
            raise ValueError("Archived object integrity mismatch")
    key_reference = directory / "key-reference.json"
    if (
        manifest.get("localKeySha256")
        and fingerprint(directory / "identity-key.pem") != manifest["localKeySha256"]
    ):
        raise ValueError("LOCAL signing key integrity mismatch")
    if (
        key_reference.exists()
        and fingerprint(directory / "identity-key.pem")
        != json.loads(key_reference.read_text(encoding="utf-8"))["keySha256"]
    ):
        raise ValueError("Signing key integrity mismatch")


def replay_plan(archives, snapshot):
    boundary = snapshot["binlogBoundary"]
    if (
        not re.fullmatch(r"[A-Za-z0-9_-]+\.[0-9]{6}", boundary["file"])
        or type(boundary["position"]) is not int
        or boundary["position"] < 4
    ):
        raise ValueError("Snapshot binlog boundary rejected")
    prefix = boundary["file"].rsplit(".", 1)[0]
    previous = None
    entries = []
    for directory, manifest in archives:
        if (
            manifest.get("kind") != "closed-binlogs"
            or manifest.get("serverUuid") != snapshot["source"]["serverUuid"]
            or not manifest.get("logs")
        ):
            raise ValueError("PITR source or archive scope mismatch")
        for entry in manifest["logs"]:
            name = entry["file"]
            if (
                not re.fullmatch(re.escape(prefix) + r"\.[0-9]{6}", name)
                or name != entry["sourceFile"]
                or type(entry["startPosition"]) is not int
                or entry["startPosition"] < 4
                or entry["startPosition"] > (directory / name).stat().st_size
                or fingerprint(directory / name) != entry["sha256"]
            ):
                raise ValueError("PITR log path, range or integrity mismatch")
            if previous is not None and (
                int(name.rsplit(".", 1)[1]) != int(previous.rsplit(".", 1)[1]) + 1
                or entry["startPosition"] != 4
            ):
                raise ValueError(
                    "PITR log sequence has a gap, overlap or partial continuation"
                )
            previous = name
            entries.append((directory, entry))
        expected_next = prefix + "." + str(int(previous.rsplit(".", 1)[1]) + 1).zfill(6)
        if manifest.get("nextBoundary") != {"file": expected_next, "position": 4}:
            raise ValueError(
                "Closed-binlog archive cursor does not follow its last file"
            )
    start = next(
        (
            i
            for i, (_, entry) in enumerate(entries)
            if entry["file"] == boundary["file"]
        ),
        None,
    )
    if start is None:
        raise ValueError("PITR chain does not contain the snapshot boundary file")
    directory, first = entries[start]
    if (
        not first["startPosition"]
        <= boundary["position"]
        <= (directory / first["file"]).stat().st_size
    ):
        raise ValueError("PITR chain does not cover the snapshot boundary position")
    return [
        (directory, entry["file"], boundary["position"] if index == start else 4)
        for index, (directory, entry) in enumerate(entries)
        if index >= start
    ]


def replay_chain(sandbox, archives, snapshot, stop_time=None):
    if stop_time and not re.fullmatch(
        r"20[0-9]{2}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}", stop_time
    ):
        raise ValueError("Use an explicit UTC MySQL stop-datetime")
    plan = replay_plan(archives, snapshot)
    for directory, name, position in plan:
        remote = "/tmp/" + name
        run(["docker", "cp", str(directory / name), sandbox.name + ":" + remote])
        options = [
            "docker",
            "exec",
            "--env",
            "TZ=UTC",
            sandbox.name,
            "mysqlbinlog",
            "--verify-binlog-checksum",
            "--start-position=" + str(position),
        ]
        if stop_time:
            options.append("--stop-datetime=" + stop_time)
        output = directory / "replay.sql"
        with output.open("wb") as stream:
            run([*options, remote], output=stream)
        sandbox.restore(output)
    return len(plan)


def replay(sandbox, directory, manifest, snapshot, stop_time=None):
    return replay_chain(sandbox, [(directory, manifest)], snapshot, stop_time)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--identity", type=Path, required=True)
    parser.add_argument(
        "--binlogs",
        type=Path,
        nargs="+",
        help="Consecutive encrypted closed-binlog archives in capture order",
    )
    parser.add_argument(
        "--stop-time", help="UTC YYYY-MM-DD HH:MM:SS; whole transactions only"
    )
    parser.add_argument("--age", default="age")
    parser.add_argument(
        "--export-protected",
        type=Path,
        help="Explicit private directory for reviewed isolated GCS restore; never a repository artifact",
    )
    parser.add_argument(
        "--report", type=Path, default=Path("testing/reports/online-restore.json")
    )
    args = parser.parse_args()
    if args.stop_time and not args.binlogs:
        raise ValueError("--stop-time requires a binlog archive")
    if args.export_protected and args.binlogs:
        raise ValueError(
            "PITR SQL export requires additional target-generation coverage review; only base snapshots can be exported here"
        )
    started = time.monotonic()
    with decrypted(args.snapshot, args.identity, args.age) as (directory, manifest):
        validate_snapshot(directory, manifest)
        with Sandbox(tools=bool(args.binlogs)) as sandbox:
            sandbox.restore(directory / "databases.sql")
            if snapshot_metadata(sandbox) != {
                key: manifest[key] for key in ("flyway", "databaseTableCounts")
            }:
                raise ValueError("Snapshot schemas differ after isolated restore")
            if args.binlogs:
                with ExitStack() as stack:
                    archives = [
                        stack.enter_context(decrypted(archive, args.identity, args.age))
                        for archive in args.binlogs
                    ]
                    replay_chain(sandbox, archives, manifest, args.stop_time)
            report = {
                "sqlRecovery": "PASS",
                "databases": len(DBS),
                "pitrSqlReplayed": bool(args.binlogs),
                "sqlRtoSeconds": round(time.monotonic() - started, 2),
                "applicationRecovery": "NOT_RUN",
                "gcsRecovery": "NOT_RUN",
                "kafkaReplay": "NOT_RUN",
                "note": "SQL-only drill; not an approved application recovery point or measured application RPO/RTO",
            }
        if args.export_protected:
            if args.export_protected.exists():
                raise ValueError("Protected restore export must be a new directory")
            shutil.copytree(directory, args.export_protected)
            args.export_protected.chmod(0o700)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    print("PASS isolated SQL recovery; application/GCS/Kafka gates remain separate")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit(
            "Isolated recovery failed; no recovery point approved. Protected output withheld."
        ) from None
