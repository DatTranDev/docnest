"""Real old/new-image compatibility on expanded schemas in a disposable Compose project.

No host application volumes, cloud resources, Stripe calls or shared Kafka state.
This proves the exercised HTTP/schema paths; event/protocol compatibility is a
separate gate and is deliberately not inferred from an HTTP pass.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import tempfile
import time
import uuid

from digest_manifest import NAMES
from rollout_traffic import TrafficMonitor

ROOT = Path(__file__).resolve().parents[2]


def run(args, *, environment=None, timeout=600):
    values = os.environ.copy() if environment is None else environment.copy()
    if "--env-file" in args:
        config = Path(args[args.index("--env-file") + 1])
        values.update(profile_values(config))
    try:
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=values,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise ValueError(
            "Isolated compatibility command unavailable or timed out"
        ) from None
    if result.returncode:
        raise ValueError(
            "Isolated compatibility command failed; protected output withheld"
        )
    return result.stdout


def profile_values(path):
    return {
        key: value
        for line in path.read_text(encoding="utf-8").splitlines()
        if line and not line.startswith("#") and "=" in line
        for key, value in [line.split("=", 1)]
    }


def image(reference):
    # Resolve once; never let a tag move between the old/new test phases.
    value = json.loads(run(["docker", "image", "inspect", reference]))[0]["Id"]
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", value):
        raise ValueError("Expected a locally available immutable image")
    return value


def environment(path, port):
    values = {}
    for line in (ROOT / ".env.example").read_text(encoding="utf-8").splitlines():
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key] = value
    for key in values:
        if key.endswith(("PASSWORD", "KEY")):
            values[key] = secrets.token_hex(32)
    values.update(
        WEB_PORT=str(port),
        WEB_ORIGIN=f"http://localhost:{port}",
        STORAGE_PROVIDER="LOCAL",
        GOOGLE_CLIENT_ID="",
        STRIPE_SECRET_KEY="",
        STRIPE_WEBHOOK_SECRET="",
        STRIPE_PRO_MONTHLY_PRICE="",
        STRIPE_PRO_YEARLY_PRICE="",
        MAX_USERS="10",
    )
    # Newer participants may be absent from older .env examples.
    for owner in ("COLLABORATION", "PAYMENT", "IDENTITY", "DOCUMENT", "PROCESSING"):
        values.setdefault(owner + "_DB_PASSWORD", secrets.token_hex(32))
        values.setdefault("KAFKA_" + owner + "_PASSWORD", secrets.token_hex(32))
    path.write_text(
        "\n".join(key + "=" + value for key, value in values.items()) + "\n"
    )
    path.chmod(0o600)


def overlay(path, images, service, selected, port):
    lines = ["services:"]
    for name in NAMES:
        lines += [
            "  " + name + ":",
            "    image: " + (selected if name == service else images[name]),
        ]
        if name == "web":
            lines += ["    ports: !override", f"      - '127.0.0.1:{port}:8080'"]
        else:
            lines += ["    environment:", "      FLYWAY_ENABLED: 'false'"]
    path.write_text("\n".join(lines) + "\n")


def history(prefix):
    sql = "\n".join(
        "SELECT JSON_OBJECT('owner','"
        + owner
        + "','version',version,'checksum',checksum,'success',success) FROM "
        + owner
        + "_db.flyway_schema_history WHERE version IS NOT NULL ORDER BY installed_rank;"
        for owner in ("identity", "document", "processing", "collaboration", "payment")
    )
    result = subprocess.run(
        [
            *prefix,
            "exec",
            "-T",
            "mysql",
            "bash",
            "-c",
            'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --batch --raw --skip-column-names',
        ],
        input=sql,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode:
        raise ValueError("Isolated migration history could not be read")
    rows = [json.loads(line) for line in result.stdout.splitlines() if line]
    if not rows or any(row["success"] != 1 for row in rows):
        raise ValueError("Unsuccessful migration in isolated compatibility database")
    return {
        owner: hashlib.sha256(
            json.dumps(
                [row for row in rows if row["owner"] == owner], sort_keys=True
            ).encode()
        ).hexdigest()
        for owner in ("identity", "document", "processing", "collaboration", "payment")
    }


class IsolatedStack:
    """A new app project for acceptance; cleanup only touches its random owned volumes."""

    def __init__(self, port=18083):
        self.project = "docsnest-check-" + uuid.uuid4().hex[:12]
        self.temporary = tempfile.TemporaryDirectory(prefix=self.project)
        self.folder = Path(self.temporary.name)
        self.config, self.patch = self.folder / ".env", self.folder / "compose.yaml"
        self.port = port
        images = {name: image("text-editor/" + name + ":local") for name in NAMES}
        environment(self.config, port)
        overlay(
            self.patch, images, "document-service", images["document-service"], port
        )
        self.prefix = [
            "docker",
            "compose",
            "--project-name",
            self.project,
            "--env-file",
            str(self.config),
            "-f",
            str(ROOT / "infra/compose/compose.yaml"),
            "-f",
            str(self.patch),
            "--profile",
            "app",
        ]

    def __enter__(self):
        try:
            run(
                [
                    *self.prefix,
                    "up",
                    "-d",
                    "--no-build",
                    "--wait",
                    "--wait-timeout",
                    "240",
                    "mysql",
                    "kafka",
                    "redis",
                ]
            )
            run(
                [
                    *self.prefix,
                    "exec",
                    "-T",
                    "kafka",
                    "bash",
                    "/opt/editor-kafka/kafka-init-acls.sh",
                ]
            )
            for name in NAMES[:-1]:
                flag = (
                    "--migrate-only"
                    if name == "identity-service"
                    else "--editor.migrate-only=true"
                )
                run([*self.prefix, "run", "--rm", "--no-deps", "-T", name, flag])
            run(
                [
                    *self.prefix,
                    "up",
                    "-d",
                    "--no-build",
                    "--wait",
                    "--wait-timeout",
                    "360",
                ]
            )
            return self
        except Exception:
            self.__exit__()
            raise

    def child_environment(self):
        return {
            **os.environ,
            **profile_values(self.config),
            "EDITOR_ENV_FILE": str(self.config),
            "EDITOR_COMPOSE_PROJECT": self.project,
            "EDITOR_COMPOSE_OVERRIDE": str(self.patch),
            "EDITOR_BASE_URL": f"http://localhost:{self.port}",
            "SMOKE_BASE_URL": f"http://localhost:{self.port}",
        }

    def __exit__(self, *unused):
        if not re.fullmatch(r"docsnest-check-[a-f0-9]{12}", self.project):
            raise ValueError("Isolated app ownership changed; cleanup refused")
        run([*self.prefix, "down", "--volumes", "--remove-orphans"])
        self.temporary.cleanup()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service", choices=NAMES[:-1], required=True)
    parser.add_argument("--old-image", required=True)
    parser.add_argument("--new-image", required=True)
    parser.add_argument(
        "--images",
        type=Path,
        help="All six dependency image references; defaults to local fixtures",
    )
    parser.add_argument("--port", type=int, default=18081)
    parser.add_argument("--seconds", type=int, default=15)
    parser.add_argument(
        "--report", type=Path, default=ROOT / "testing/reports/mixed-version.json"
    )
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535 or not 5 <= args.seconds <= 300:
        raise ValueError("Invalid bounded compatibility port/duration")
    references = (
        json.loads(args.images.read_text(encoding="utf-8"))
        if args.images
        else {name: "text-editor/" + name + ":local" for name in NAMES}
    )
    if set(references) != set(NAMES):
        raise ValueError("All six dependency images are required")
    images = {name: image(reference) for name, reference in references.items()}
    old, new = image(args.old_image), image(args.new_image)
    if old == new:
        raise ValueError("Identical images do not prove mixed-version compatibility")
    project = "docsnest-compat-" + uuid.uuid4().hex[:12]
    started = time.monotonic()
    result = {
        "status": "PENDING",
        "schemaCompatible": False,
        "eventsCompatible": False,
        "nativeFormatVersion": 6,
        "scope": "Old/new service images on the candidate schema; synthetic HTTP/ACL/save/export only",
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=project) as directory:
        folder = Path(directory)
        config, patch = folder / ".env", folder / "compose.yaml"
        environment(config, args.port)
        overlay(patch, images, args.service, new, args.port)
        prefix = [
            "docker",
            "compose",
            "--project-name",
            project,
            "--env-file",
            str(config),
            "-f",
            str(ROOT / "infra/compose/compose.yaml"),
            "-f",
            str(patch),
            "--profile",
            "app",
        ]
        try:
            run(
                [
                    *prefix,
                    "up",
                    "-d",
                    "--no-build",
                    "--wait",
                    "--wait-timeout",
                    "240",
                    "mysql",
                    "kafka",
                    "redis",
                ]
            )
            run(
                [
                    *prefix,
                    "exec",
                    "-T",
                    "kafka",
                    "bash",
                    "/opt/editor-kafka/kafka-init-acls.sh",
                ]
            )
            for name in NAMES[:-1]:
                flag = (
                    "--migrate-only"
                    if name == "identity-service"
                    else "--editor.migrate-only=true"
                )
                run([*prefix, "run", "--rm", "--no-deps", "-T", name, flag])
            baseline = history(prefix)
            run([*prefix, "up", "-d", "--no-build", "--wait", "--wait-timeout", "360"])
            credentials = [
                "compat-owner@editor.test",
                secrets.token_urlsafe(24),
                "compat-viewer@editor.test",
                secrets.token_urlsafe(24),
            ]
            for label, selected in (("old", old), ("new", new)):
                overlay(patch, images, args.service, selected, args.port)
                run(
                    [
                        *prefix,
                        "up",
                        "-d",
                        "--no-build",
                        "--no-deps",
                        "--wait",
                        "--wait-timeout",
                        "300",
                        args.service,
                    ]
                )
                with TrafficMonitor(
                    f"http://localhost:{args.port}",
                    credentials,
                    register=label == "old",
                    report=str(
                        args.report.with_name("mixed-version-" + label + ".json")
                    ),
                ) as traffic:
                    deadline = time.monotonic() + args.seconds
                    while time.monotonic() < deadline:
                        traffic.require_healthy()
                        time.sleep(1)
                if history(prefix) != baseline:
                    raise ValueError(
                        "Normal old/new startup unexpectedly mutated the schema"
                    )
            result.update(
                status="PASS",
                schemaCompatible=True,
                flywayHistorySha256=baseline,
                oldImages={**references, args.service: args.old_image},
                newImages={**references, args.service: args.new_image},
                resolvedOldImages={**images, args.service: old},
                resolvedNewImages={**images, args.service: new},
                eventCompatibility="NOT_VERIFIED; review real event/consumer/saga evidence separately",
            )
        finally:
            # A random explicit project owns all these new volumes. Never target
            # the user's default text-editor project or pre-existing volumes.
            if not re.fullmatch(r"docsnest-compat-[a-f0-9]{12}", project):
                raise ValueError("Isolated project ownership check failed")
            run([*prefix, "down", "--volumes", "--remove-orphans"])
            result["durationSeconds"] = round(time.monotonic() - started, 2)
            args.report.write_text(json.dumps(result, indent=2) + "\n")
    print(
        "PASS old/new images on expanded schema; event compatibility is a separate gate"
    )


if __name__ == "__main__":
    main()
