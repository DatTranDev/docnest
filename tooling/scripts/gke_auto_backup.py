"""Quiesce an existing GKE app, capture/encrypt/upload its backup, never restore SQL."""

import argparse
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
from types import SimpleNamespace

from cloud_backup import APPS, backup, protected_json, run
from digest_manifest import validate_manifest

OWNER = "docsnest.dattrandev.id.vn/backup-run"


@dataclass(frozen=True)
class Configuration:
    project: str
    region: str
    zone: str
    cluster: str
    snapshots: str
    results: str
    backups: str
    recipient: str
    jwt_version: str
    run_id: str

    def __post_init__(self):
        values = (
            (self.project, r"[a-z][a-z0-9-]{4,61}[a-z0-9]"),
            (self.region, r"[a-z]+-[a-z]+[0-9]+"),
            (self.zone, re.escape(self.region) + r"-[a-z]"),
            (self.cluster, r"[a-z][a-z0-9-]{0,61}[a-z0-9]"),
            (self.run_id, r"gh-[0-9]{1,20}-[0-9]{1,6}"),
            (self.jwt_version, r"[1-9][0-9]{0,19}"),
            (self.recipient, r"age1[0-9a-z]{58}"),
        )
        if any(not re.fullmatch(pattern, value) for value, pattern in values):
            raise ValueError("Invalid automatic backup configuration")
        buckets = (self.snapshots, self.results, self.backups)
        if len(set(buckets)) != 3 or any(
            not re.fullmatch(r"[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]", value)
            for value in buckets
        ):
            raise ValueError("Backup requires three distinct configured buckets")

    @property
    def context(self):
        return f"gke_{self.project}_{self.zone}_{self.cluster}"

    @property
    def reference(self):
        return f"gs://{self.backups}/gke/pre-update-{self.run_id}.age"


class Cluster:
    def __init__(self, configuration):
        self.configuration = configuration
        self.prefix = [
            "kubectl",
            "--context",
            configuration.context,
            "-n",
            "editor-lab",
        ]

    def get(self, kind, name):
        return json.loads(run(self.prefix + ["get", kind, name, "-o", "json"]))

    def patch(self, name, current, operations):
        # A concurrent operator's update must not be overwritten.
        patch = [
            {
                "op": "test",
                "path": "/metadata/resourceVersion",
                "value": current["metadata"]["resourceVersion"],
            },
            *operations,
        ]
        run(
            self.prefix
            + ["patch", "deployment", name, "--type=json", "--patch-file=/dev/stdin"],
            data=json.dumps(patch).encode("utf-8"),
        )

    def pause(self, name, current):
        live = self.get("deployment", name)
        if (
            live["metadata"]["uid"] != current["metadata"]["uid"]
            or live["spec"]["template"] != current["spec"]["template"]
            or live["spec"].get("replicas", 1) != current["spec"].get("replicas", 1)
            or current["spec"].get("replicas", 1) < 1
            or OWNER in live["metadata"].get("annotations", {})
        ):
            raise ValueError("Application changed before backup pause")
        current = live
        annotations = dict(current["metadata"].get("annotations", {}))
        annotations[OWNER] = self.configuration.run_id
        self.patch(
            name,
            current,
            [
                {"op": "add", "path": "/metadata/annotations", "value": annotations},
                {"op": "replace", "path": "/spec/replicas", "value": 0},
            ],
        )

    def wait_stopped(self, name):
        run(
            self.prefix
            + ["wait", "--for=delete", "pod", "-l", "app=" + name, "--timeout=300s"]
        )

    def clear(self, name, current, *, resume=False, replicas=1):
        if (
            current["metadata"].get("annotations", {}).get(OWNER)
            != self.configuration.run_id
        ):
            return
        operations = [
            {
                "op": "remove",
                "path": "/metadata/annotations/" + OWNER.replace("/", "~1"),
            }
        ]
        if resume:
            if (
                not isinstance(replicas, int)
                or isinstance(replicas, bool)
                or replicas < 1
            ):
                raise ValueError(
                    "Recovery requires the captured positive replica count"
                )
            operations.append(
                {"op": "replace", "path": "/spec/replicas", "value": replicas}
            )
        self.patch(name, current, operations)


def inventory(cluster):
    deployments = {name: cluster.get("deployment", name) for name in APPS}
    images = {}
    for name, deployment in deployments.items():
        desired = deployment["spec"].get("replicas", 1)
        if (
            not isinstance(desired, int)
            or isinstance(desired, bool)
            or desired < 1
            or deployment.get("status", {}).get("availableReplicas", 0) != desired
            or deployment.get("status", {}).get("updatedReplicas", 0) != desired
            or deployment["status"].get("observedGeneration", 0)
            < deployment["metadata"]["generation"]
            or OWNER in deployment["metadata"].get("annotations", {})
        ):
            raise ValueError(
                "Backup requires six stable positive-replica Deployments without maintenance"
            )
        images[name] = deployment["spec"]["template"]["spec"]["containers"][0]["image"]
    validate_manifest(
        images, cluster.configuration.project, cluster.configuration.region
    )
    config = cluster.get("configmap", "editor-config")
    if (
        config["data"]["SNAPSHOTS_BUCKET"] != cluster.configuration.snapshots
        or config["data"]["GCS_BUCKET"] != cluster.configuration.results
    ):
        raise ValueError(
            "Configured backup source buckets differ from running application"
        )
    return deployments, images, config


def recover_before_mutations(cluster, previous, config):
    # This recovery is only for a failed read-only backup, before migration/rollout.
    current = {name: cluster.get("deployment", name) for name in APPS}
    live_config = cluster.get("configmap", "editor-config")
    if (
        live_config["metadata"]["uid"] != config["metadata"]["uid"]
        or any(
            live_config.get(key) != config.get(key) for key in ("data", "binaryData")
        )
        or any(
            current[name]["metadata"]["uid"] != previous[name]["metadata"]["uid"]
            or current[name]["spec"]["template"] != previous[name]["spec"]["template"]
            or current[name]["spec"].get("replicas", 1)
            not in (0, previous[name]["spec"].get("replicas", 1))
            or current[name]["metadata"].get("annotations", {}).get(OWNER)
            not in (None, cluster.configuration.run_id)
            or (
                current[name]["spec"].get("replicas", 1) == 0
                and current[name]["metadata"].get("annotations", {}).get(OWNER)
                != cluster.configuration.run_id
            )
            for name in APPS
        )
    ):
        raise ValueError(
            "Application changed during backup; manual maintenance recovery required"
        )
    for name in (*APPS[:-1], "web"):
        cluster.clear(
            name,
            current[name],
            resume=True,
            replicas=previous[name]["spec"].get("replicas", 1),
        )


def capture(configuration, cluster, directory, *, capture_backup=backup, execute=run):
    previous, images, config = inventory(cluster)
    # Validate the actual recipient before making the app unavailable.
    probe = directory / "recipient-probe.age"
    execute(["age", "-r", configuration.recipient, "-o", str(probe), os.devnull])
    images_file = directory / "running-digests.json"
    protected_json(images_file, images)
    try:
        # Stop the public writer before background service writers; SQL/Kafka stay running.
        for name in ("web", *APPS[:-1]):
            cluster.pause(name, previous[name])
        for name in APPS:
            cluster.wait_stopped(name)
        print(
            "Backup writers stopped; capturing SQL, signing key and referenced object generations"
        )
        archive = directory / "capture"
        capture_backup(
            SimpleNamespace(
                environment="gke",
                kube_context=configuration.context,
                directory=archive,
                images=images_file,
                project=configuration.project,
                jwt_secret_version=f"projects/{configuration.project}/secrets/editor-jwt/versions/{configuration.jwt_version}",
            )
        )
        if not (archive / "manifest.json").is_file():
            raise ValueError("Backup capture did not produce its integrity manifest")
        print("Backup captured; encrypting archive")
        plain = directory / "capture.tar"
        with tarfile.open(plain, "w") as output:
            output.add(archive, arcname="capture")
        encrypted = directory / "capture.tar.age"
        execute(
            ["age", "-r", configuration.recipient, "-o", str(encrypted), str(plain)]
        )
        if encrypted.stat().st_size == 0:
            raise ValueError("Encrypted backup is empty")
        print("Uploading encrypted archive")
        execute(
            [
                "gcloud",
                "storage",
                "cp",
                str(encrypted),
                configuration.reference,
                "--project=" + configuration.project,
                "--if-generation-match=0",
            ]
        )
    except Exception:
        print("Read-only backup failed; attempting guarded recovery before migrations")
        recover_before_mutations(cluster, previous, config)
        raise
    # Leave all applications quiesced until the deploy identity migrates and rolls out.
    print("Encrypted fresh backup uploaded; applications remain paused for rollout")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("capture", "complete"))
    args = parser.parse_args()
    os.umask(0o077)
    try:
        configuration = Configuration(
            *(
                os.environ[key]
                for key in (
                    "PROJECT",
                    "REGION",
                    "ZONE",
                    "CLUSTER",
                    "SNAPSHOTS",
                    "RESULTS",
                    "BACKUPS",
                    "BACKUP_AGE_RECIPIENT",
                    "JWT_SECRET_VERSION",
                    "BACKUP_RUN_ID",
                )
            )
        )
        cluster = Cluster(configuration)
        if args.command == "complete":
            for name in APPS:
                cluster.clear(name, cluster.get("deployment", name))
            print("Completed automatic-backup maintenance ownership")
        else:
            if os.environ["BACKUP_REFERENCE"] != configuration.reference:
                raise ValueError("Automatic backup reference differs from this run")
            # TemporaryDirectory removes plaintext even on failure; never upload this directory.
            with tempfile.TemporaryDirectory(
                prefix="docnest-gke-backup-", dir=os.environ["RUNNER_TEMP"]
            ) as temporary:
                capture(configuration, cluster, Path(temporary))
    except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError):
        raise SystemExit(
            "Automatic backup failed; protected details withheld. If backup recovery failed or migrations started, inspect maintenance state before resuming."
        ) from None


if __name__ == "__main__":
    main()
