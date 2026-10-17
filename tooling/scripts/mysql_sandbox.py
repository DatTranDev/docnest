"""Owned, disposable MySQL 8.4 recovery database. No host ports or application volumes."""

import json
import os
import secrets
import subprocess
import time
import uuid
from pathlib import Path

IMAGE = "mysql:8.4.7@sha256:0426ec38c7a10aa45ba383887df7878f74ee70e2fd589c7b69207f3577901903"
TOOLS_IMAGE = "text-editor/mysql-recovery-tools:8.4.7"


def run(args, **kwargs):
    try:
        result = subprocess.run(args, capture_output=True, timeout=600, **kwargs)
    except (OSError, subprocess.TimeoutExpired):
        raise ValueError(
            "Recovery command unavailable or timed out; output withheld"
        ) from None
    if result.returncode:
        raise ValueError("Recovery command failed; protected output withheld")
    return result.stdout


class Sandbox:
    def __init__(self, *, binlog=False, tools=False):
        self.name = "docsnest-recovery-" + uuid.uuid4().hex
        self.label = "docsnest.recovery-owner=" + self.name
        self.binlog = binlog
        self.image = TOOLS_IMAGE if tools else IMAGE

    def command(
        self,
        cli="mysql -uroot --default-character-set=utf8mb4 --batch --raw --unbuffered --skip-column-names",
    ):
        return [
            "docker",
            "exec",
            "-i",
            self.name,
            "bash",
            "-c",
            'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec ' + cli,
        ]

    def __enter__(self):
        environment = os.environ.copy()
        environment["MYSQL_ROOT_PASSWORD"] = secrets.token_urlsafe(32)
        run(
            [
                "docker",
                "run",
                "-d",
                "--name",
                self.name,
                "--label",
                self.label,
                "--network",
                "none",
                "--memory",
                "768m",
                "--env",
                "MYSQL_ROOT_PASSWORD",
                self.image,
                *([] if self.binlog else ["--skip-log-bin"]),
                "--innodb-buffer-pool-size=128M",
            ],
            env=environment,
        )
        try:
            for _ in range(90):
                try:
                    if (
                        run(self.command(), input=b"SELECT @@port;\n").strip()
                        == b"3306"
                    ):
                        return self
                except ValueError:
                    time.sleep(1)
            raise ValueError("Disposable recovery MySQL did not become ready")
        except Exception:
            self.close()
            raise

    def restore(self, source):
        with source.open("rb") as stream:
            run(self.command(), stdin=stream)

    def query(self, database, sql):
        from cloud_backup import DBS

        if database not in DBS:
            raise ValueError("Database outside the five-owner allowlist")
        output = run(self.command(), input=("USE " + database + ";\n" + sql).encode())
        return [json.loads(line) for line in output.decode().splitlines() if line]

    def close(self):
        labels = json.loads(
            run(["docker", "inspect", "--format", "{{json .Config.Labels}}", self.name])
        )
        if labels.get("docsnest.recovery-owner") != self.name:
            raise ValueError("Disposable container ownership changed; cleanup refused")
        run(["docker", "rm", "--force", "--volumes", self.name])

    def __exit__(self, *unused):
        self.close()


def build_tools():
    root = Path(__file__).resolve().parents[2]
    run(
        [
            "docker",
            "build",
            "-f",
            str(root / "infra/backup/MySQLTools.Dockerfile"),
            "-t",
            TOOLS_IMAGE,
            str(root / "infra/backup"),
        ]
    )
