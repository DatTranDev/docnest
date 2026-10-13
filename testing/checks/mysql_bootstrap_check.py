"""Fresh real MySQL bootstrap with a Linux mode-0644 init script; no app volumes."""

import os
from pathlib import Path
import re
import secrets
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
IMAGE = "mysql:8.4.7@sha256:0426ec38c7a10aa45ba383887df7878f74ee70e2fd589c7b69207f3577901903"
OWNERS = ("identity", "document", "processing", "collaboration", "payment")


def command(arguments, *, env=None):
    return subprocess.run(
        arguments, env=env, capture_output=True, text=True, timeout=240
    )


def main():
    container = "editor-bootstrap-check-" + uuid.uuid4().hex[:12]
    values = {
        key: secrets.token_hex(32)
        for key in (
            "MYSQL_ROOT_PASSWORD",
            *(s.upper() + "_DB_PASSWORD" for s in OWNERS),
        )
    }
    env = {**os.environ, **values}
    arguments = ["docker", "run", "-d", "--name", container, "--memory=768m"]
    for key in values:
        arguments += ["--env", key]
    arguments += [
        "--mount",
        "type=bind,source="
        + str(ROOT / "infra/compose/mysql-init.sh")
        + ",target=/incoming/mysql-init.sh,readonly",
        "--entrypoint",
        "bash",
        IMAGE,
        "-c",
        "install -m 0644 /incoming/mysql-init.sh /docker-entrypoint-initdb.d/01-editor.sh; "
        "exec /usr/local/bin/docker-entrypoint.sh mysqld "
        "--innodb-buffer-pool-size=256M --max-connections=100",
    ]
    try:
        if command(arguments, env=env).returncode:
            raise AssertionError("Disposable MySQL failed to start; output withheld")
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            logs = command(["docker", "logs", container])
            output = logs.stdout + logs.stderr
            unbound = re.search(r"\b(MYSQL_[A-Z_]+): unbound variable", output)
            if unbound:
                raise AssertionError("Bootstrap leaked shell options: " + unbound[1])
            state = command(
                ["docker", "inspect", "--format", "{{.State.Running}}", container]
            )
            if state.stdout.strip() != "true":
                raise AssertionError(
                    "Bootstrap stopped before readiness; output withheld"
                )
            if "MySQL init process done" in output:
                break
            time.sleep(1)
        else:
            raise AssertionError("Fresh MySQL initialization exceeded 180 seconds")
        # The final server starts after the temporary initialization server stops.
        while time.monotonic() < deadline:
            ready = command(
                [
                    "docker",
                    "exec",
                    container,
                    "mysqladmin",
                    "ping",
                    "-h127.0.0.1",
                    "--silent",
                ]
            )
            if ready.returncode == 0:
                break
            time.sleep(1)
        else:
            raise AssertionError("Final MySQL server did not become ready")
        for owner in OWNERS:
            query = command(
                [
                    "docker",
                    "exec",
                    container,
                    "bash",
                    "-c",
                    'MYSQL_PWD="${!1}" exec mysql --protocol=TCP -h127.0.0.1 '
                    '-u"$2" --batch --skip-column-names "$3" -e "SELECT DATABASE()"',
                    "bootstrap-check",
                    owner.upper() + "_DB_PASSWORD",
                    owner,
                    owner + "_db",
                ]
            )
            if query.returncode or query.stdout.strip() != owner + "_db":
                raise AssertionError("Fresh database owner login failed: " + owner)
        print("PASS fresh mode-0644 MySQL bootstrap and all five database owner logins")
    finally:
        command(["docker", "rm", "-fv", container])


if __name__ == "__main__":
    main()
