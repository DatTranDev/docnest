"""Existing-runner schedule entry point; fails closed and writes scalar backup metrics."""

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import time
import uuid
from types import SimpleNamespace

from online_backup import capture, archive_binlogs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--mode", choices=["snapshot", "binlogs"], default="snapshot")
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8"))
    directory = Path(config["outputDirectory"])
    if not directory.is_dir() or not Path(config["metricsFile"]).parent.is_dir():
        raise ValueError(
            "Provision and protect the existing runner's directories first"
        )
    name = (
        args.mode
        + "-"
        + dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        + "-"
        + uuid.uuid4().hex[:8]
        + ".age"
    )
    options = SimpleNamespace(
        mysql_defaults=Path(config["mysqlDefaults"]),
        local_container=None,
        output=directory / name,
        recipient=config["recipient"],
        age=config["age"],
        project=config["project"],
        region=config["region"],
        server_uuid=config["mysqlServerUuid"],
        context=config["context"],
        images=Path(config["images"]),
        jwt_secret_version=config["jwtSecretVersion"],
        destination=config["destinationPrefix"].rstrip("/") + "/" + name,
    )
    # Nonzero exit preserves the last success timestamp: stale/missing alerts keep firing.
    cursor = directory / "binlog-cursor.json"
    lock = directory / "schedule.lock"
    descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        os.close(descriptor)
        started = time.monotonic()
        if args.mode == "snapshot":
            capture(options)
        else:
            boundary = json.loads(cursor.read_text(encoding="utf-8"))
            options.start_file = boundary["nextBoundary"]["file"]
            options.start_position = boundary["nextBoundary"]["position"]
            options.server_uuid = boundary["serverUuid"]
            archive_binlogs(options)
        receipt = json.loads(
            options.output.with_suffix(".age.receipt.json").read_text(encoding="utf-8")
        )
        if args.mode == "binlogs" or not cursor.exists():
            temporary = cursor.with_suffix(".partial")
            temporary.write_text(
                json.dumps(
                    {key: receipt[key] for key in ("serverUuid", "nextBoundary")}
                )
            )
            temporary.replace(cursor)
    finally:
        lock.unlink()
    metrics = Path(config["metricsFile"])
    temporary = metrics.with_suffix(".tmp")
    if args.mode == "binlogs":
        metrics = metrics.with_name("docsnest-binlogs.prom")
        temporary = metrics.with_suffix(".tmp")
    temporary.write_text(
        f"docsnest_backup_{args.mode}_timestamp_seconds {int(time.time())}\n"
        f"docsnest_backup_{args.mode}_duration_seconds {time.monotonic() - started:.3f}\n"
    )
    temporary.replace(metrics)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit(
            "Independent backup schedule failed; last-success metric unchanged. Protected output withheld."
        ) from None
