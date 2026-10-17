"""Restore a live LOCAL snapshot into a new complete app stack; no source outage or restore.

Exercises five SQL owners, original JWT, referenced native objects, login, save,
export and subscription reads. GCS/Stripe/provider recovery remains a cloud gate.
"""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import uuid

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tooling/scripts"))
from digest_manifest import NAMES
from mixed_version_check import environment, image, overlay, run
from online_backup import Source, capture
from online_restore import decrypted, validate_snapshot
from rollout_traffic import Client, Measurements, TrafficMonitor
from run import initialize, compose_prefix
from runtime_diagnostics import collect as runtime_diagnostics


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--age", required=True)
    parser.add_argument("--age-keygen", required=True)
    parser.add_argument("--port", type=int, default=18082)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        raise ValueError("Invalid private restore port")
    diagnostic_start = time.time()
    report_path = ROOT / "testing/reports/local-online-restore.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps({"status": "PENDING"}) + "\n", encoding="utf-8")
    root_password = initialize()["MYSQL_ROOT_PASSWORD"]
    source_prefix = compose_prefix() + ["--profile", "app"]
    source_containers = {
        name: run([*source_prefix, "ps", "-q", name]).strip()
        for name in ("mysql", *NAMES)
    }
    import os

    source_origin = os.environ.get("EDITOR_BASE_URL", "http://localhost:8080")
    owner, viewer = "smoke-owner@editor.test", "smoke-recipient@editor.test"
    credentials = [
        owner,
        hashlib.sha256((root_password + owner).encode()).hexdigest()[:32],
        viewer,
        hashlib.sha256((root_password + viewer).encode()).hexdigest()[:32],
    ]
    project = "docsnest-compat-" + uuid.uuid4().hex[:12]
    with tempfile.TemporaryDirectory(prefix="docsnest-app-restore-") as temporary:
        folder = Path(temporary)
        key = folder / "key.txt"
        run([args.age_keygen, "-o", str(key)])
        recipient = run([args.age_keygen, "-y", str(key)]).strip()
        images = {
            name: run(
                ["docker", "inspect", "--format", "{{.Image}}", source_containers[name]]
            ).strip()
            for name in NAMES
        }
        image_file = folder / "images.json"
        image_file.write_text(json.dumps(images))
        archive = folder / "snapshot.age"
        with TrafficMonitor(
            source_origin,
            credentials,
            register=True,
            report="testing/reports/online-backup-source-traffic.json",
        ) as source_traffic:
            document = source_traffic.document["id"]
            expected = hashlib.sha256(source_traffic.fixture).hexdigest()
            jwks = source_traffic.owner.json("jwks", "GET", "/.well-known/jwks.json")
            capture(
                SimpleNamespace(
                    mysql_defaults=None,
                    local_container=source_containers["mysql"],
                    local_document_container=source_containers["document-service"],
                    local_identity_container=source_containers["identity-service"],
                    output=archive,
                    recipient=recipient,
                    age=args.age,
                    images=image_file,
                    project=None,
                    context=None,
                    jwt_secret_version=None,
                    destination=None,
                )
            )
            source_traffic.require_healthy()
        started = time.monotonic()
        config, patch = folder / ".env", folder / "compose.yaml"
        environment(config, args.port)
        overlay(
            patch, images, "document-service", images["document-service"], args.port
        )
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
        baseline_verified = False
        before_traffic = None
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
            with decrypted(archive, key, args.age) as (data, manifest):
                validate_snapshot(data, manifest)
                mysql = run([*prefix, "ps", "-q", "mysql"]).strip()
                with (data / "databases.sql").open("rb") as sql:
                    result = subprocess.run(
                        Source(local_container=mysql).command("mysql"),
                        stdin=sql,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        timeout=300,
                    )
                if result.returncode:
                    raise ValueError(
                        "Isolated application SQL restore failed; output withheld"
                    )
                run(
                    [
                        *prefix,
                        "up",
                        "--no-start",
                        "--no-build",
                        "--no-deps",
                        "identity-service",
                        "document-service",
                    ]
                )
                parents = sorted(
                    {
                        "/data/objects/" + entry["ref"]["key"].rsplit("/", 1)[0]
                        for entry in manifest["objects"]
                    }
                )
                if parents:
                    run(
                        [
                            *prefix,
                            "run",
                            "--rm",
                            "--no-deps",
                            "--user",
                            "0",
                            "--entrypoint",
                            "mkdir",
                            "document-service",
                            "-p",
                            *parents,
                        ]
                    )
                for entry in manifest["objects"]:
                    run(
                        [
                            *prefix,
                            "cp",
                            str(data / "objects" / entry["file"]),
                            "document-service:/data/objects/" + entry["ref"]["key"],
                        ]
                    )
                run(
                    [
                        *prefix,
                        "cp",
                        str(data / "identity-key.pem"),
                        "identity-service:/data/keys/identity-key.pem",
                    ]
                )
                for name, path in (
                    ("document-service", "/data/objects"),
                    ("identity-service", "/data/keys"),
                ):
                    run(
                        [
                            *prefix,
                            "run",
                            "--rm",
                            "--no-deps",
                            "--user",
                            "0",
                            "--entrypoint",
                            "chown",
                            name,
                            "-R",
                            "10001:10001",
                            path,
                        ]
                    )
            run([*prefix, "up", "-d", "--no-build", "--wait", "--wait-timeout", "360"])
            client = Client(f"http://localhost:{args.port}", Measurements())
            client.login(credentials[0], credentials[1])
            client.json("restored-subscription", "GET", "/api/v1/billing/subscription")
            reopened = client.request(
                "restored-native",
                "GET",
                f"/api/v1/documents/{document}/versions/1/content",
            ).content
            if (
                hashlib.sha256(reopened).hexdigest() != expected
                or client.json("jwks", "GET", "/.well-known/jwks.json") != jwks
            ):
                raise ValueError("Restored native bytes or signing key changed")
            baseline_verified = True
            before_traffic = runtime_diagnostics(prefix, diagnostic_start)
            with TrafficMonitor(
                f"http://localhost:{args.port}",
                credentials,
                report="testing/reports/restored-application-traffic.json",
            ) as traffic:
                time.sleep(8)
                traffic.require_healthy()
            # Check actual private exposition, including histogram buckets used by alerts.
            for name in NAMES[:-1]:
                metrics = run(
                    [
                        *prefix,
                        "exec",
                        "-T",
                        name,
                        "curl",
                        "-fsS",
                        "http://localhost:8080/actuator/prometheus",
                    ]
                )
                if "http_server_requests_seconds_bucket" not in metrics or (
                    name == "document-service"
                    and "editor_outbox_oldest_pending_seconds" not in metrics
                ):
                    raise ValueError(
                        "Private HTTP histogram/outbox metrics are missing"
                    )
            report = {
                "status": "PASS",
                "scope": "LOCAL storage and a new complete isolated Compose stack",
                "fiveDatabasesRestored": True,
                "originalSigningKeyPreserved": True,
                "originalNativeBytesPreserved": True,
                "loginSaveExportPassed": True,
                "privateMetricsPassed": True,
                "applicationRtoSeconds": round(time.monotonic() - started, 2),
                "gcsRestore": "NOT_RUN",
                "externalProviderRecovery": "NOT_RUN",
                "kafkaHistoricalReplay": "NOT_VERIFIED; fresh broker used, pending SQL outbox remains authoritative",
                "productionRpoRto": "NOT_MEASURED",
            }
            report["runtimeBeforeTraffic"] = before_traffic
            report_path.write_text(json.dumps(report, indent=2) + "\n")
        except Exception as error:
            report_path.write_text(
                json.dumps(
                    {
                        "status": "FAIL",
                        "scope": "Isolated LOCAL recovery; raw logs and application data withheld",
                        "errorType": type(error).__name__,
                        "originalKeyAndNativeVerified": baseline_verified,
                        "runtimeBeforeTraffic": before_traffic,
                        "targetRuntimeAfterFailure": runtime_diagnostics(
                            prefix, diagnostic_start
                        ),
                        "sourceRuntimeAfterFailure": runtime_diagnostics(
                            source_prefix, diagnostic_start
                        ),
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            raise
        finally:
            if not re.fullmatch(r"docsnest-compat-[a-f0-9]{12}", project):
                raise ValueError("Owned restore project check failed")
            run([*prefix, "down", "--volumes", "--remove-orphans"])
    print(
        "PASS full isolated LOCAL application recovery, original SQL/key/native bytes and live feature checks"
    )


if __name__ == "__main__":
    main()
