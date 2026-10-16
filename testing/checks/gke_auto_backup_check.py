"""State-machine unit checks; do not certify real GKE/SQL/GCS backup or restore."""

import copy
import contextlib
from dataclasses import replace
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tooling/scripts"))
from gke_auto_backup import APPS, OWNER, Cluster, Configuration, capture


class ClusterFixture:
    def __init__(self, configuration):
        self.configuration = configuration
        self.actions = []
        self.fail_pause = None
        self.deployments = {
            name: {
                "metadata": {"uid": name, "resourceVersion": "1", "generation": 1},
                "spec": {
                    "replicas": 1,
                    "template": {
                        "spec": {
                            "containers": [
                                {
                                    "image": f"asia-southeast1-docker.pkg.dev/example-lab/editor/{name}@sha256:"
                                    + "a" * 64
                                }
                            ]
                        }
                    },
                },
                "status": {
                    "availableReplicas": 1,
                    "updatedReplicas": 1,
                    "observedGeneration": 1,
                },
            }
            for name in APPS
        }
        self.config = {
            "metadata": {"uid": "config"},
            "data": {
                "SNAPSHOTS_BUCKET": configuration.snapshots,
                "GCS_BUCKET": configuration.results,
            },
        }

    def get(self, kind, name):
        return copy.deepcopy(
            self.config if kind == "configmap" else self.deployments[name]
        )

    def pause(self, name, previous):
        if name == self.fail_pause:
            raise ValueError("Injected pause conflict")
        self.actions.append(("pause", name))
        assert previous["spec"]["replicas"] == 1
        self.deployments[name]["spec"]["replicas"] = 0
        self.deployments[name]["metadata"].setdefault("annotations", {})[
            OWNER
        ] = self.configuration.run_id

    def wait_stopped(self, name):
        self.actions.append(("stopped", name))
        assert all(obj["spec"]["replicas"] == 0 for obj in self.deployments.values())

    def clear(self, name, current, *, resume=False):
        if (
            current["metadata"].get("annotations", {}).get(OWNER)
            == self.configuration.run_id
        ):
            self.actions.append(("resume" if resume else "clear", name))
            del self.deployments[name]["metadata"]["annotations"][OWNER]
            if resume:
                self.deployments[name]["spec"]["replicas"] = 1


class AutoBackupTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.configuration = Configuration(
            "example-lab",
            "asia-southeast1",
            "asia-southeast1-a",
            "example-cluster",
            "example-snapshots",
            "example-results",
            "example-backups",
            "age1" + "a" * 58,
            "1",
            "gh-123-1",
        )
        self.cluster = ClusterFixture(self.configuration)
        self.failure = None
        self.commands = []
        self.archive_images = None

    def execute(self, command):
        self.commands.append(command)
        if command[0] == "age":
            if self.failure == "recipient" or (
                self.failure == "encrypt" and command[-1] != os.devnull
            ):
                raise ValueError("Injected encryption failure")
            Path(command[command.index("-o") + 1]).write_bytes(
                b"encrypted-unit-fixture"
            )
        elif self.failure == "upload":
            raise ValueError("Injected upload failure")

    def capture_backup(self, arguments):
        self.cluster.actions.append(("capture", None))
        self.assertTrue(
            all(
                obj["spec"]["replicas"] == 0
                for obj in self.cluster.deployments.values()
            )
        )
        self.assertEqual(
            arguments.jwt_secret_version,
            "projects/example-lab/secrets/editor-jwt/versions/1",
        )
        self.archive_images = json.loads(arguments.images.read_text())
        if self.failure == "capture":
            raise ValueError("Injected capture failure")
        if self.failure in (
            "configuration",
            "template",
            "replacement",
            "foreign-owner",
        ):
            target = self.cluster.deployments[APPS[0]]
            if self.failure == "configuration":
                self.cluster.config["data"]["MAX_USERS"] = "20"
            elif self.failure == "template":
                target["spec"]["template"]["metadata"] = {
                    "annotations": {"changed": "true"}
                }
            elif self.failure == "replacement":
                target["metadata"]["uid"] = "replacement"
            else:
                target["metadata"]["annotations"][OWNER] = "another-maintenance"
            raise ValueError("Injected concurrent mutation")
        arguments.directory.mkdir()
        (arguments.directory / "manifest.json").write_text('{"fixture":true}')
        (arguments.directory / "databases.sql").write_text("unit-fixture-only")

    def capture(self):
        with contextlib.redirect_stdout(io.StringIO()):
            capture(
                self.configuration,
                self.cluster,
                self.directory,
                capture_backup=self.capture_backup,
                execute=self.execute,
            )

    def test_success_pauses_web_first_captures_running_digests_and_uploads_only_encrypted_archive(
        self,
    ):
        self.capture()
        self.assertEqual(self.cluster.actions[0], ("pause", "web"))
        self.assertEqual(
            [action for action, _ in self.cluster.actions].count("stopped"), 6
        )
        self.assertEqual(self.cluster.actions[-1], ("capture", None))
        self.assertEqual(set(self.archive_images), set(APPS))
        self.assertTrue(
            all(value.endswith("a" * 64) for value in self.archive_images.values())
        )
        upload = self.commands[-1]
        self.assertEqual(upload[:3], ["gcloud", "storage", "cp"])
        self.assertTrue(upload[3].endswith(".tar.age"))
        self.assertEqual(upload[4], self.configuration.reference)
        self.assertIn("--if-generation-match=0", upload)
        self.assertTrue(
            all(
                obj["spec"]["replicas"] == 0
                for obj in self.cluster.deployments.values()
            )
        )
        self.assertTrue(
            all(
                obj["metadata"]["annotations"][OWNER] == "gh-123-1"
                for obj in self.cluster.deployments.values()
            )
        )

    def test_rejects_unhealthy_unfinished_or_existing_maintenance_before_pause(self):
        changes = (
            lambda obj: obj["status"].update(availableReplicas=0),
            lambda obj: obj["status"].update(updatedReplicas=0),
            lambda obj: obj["metadata"].update(generation=2),
            lambda obj: obj["metadata"].update(annotations={OWNER: "another"}),
            lambda obj: obj["spec"].update(replicas=0),
        )
        for change in changes:
            with self.subTest(change=change):
                self.cluster = ClusterFixture(self.configuration)
                change(self.cluster.deployments[APPS[0]])
                with self.assertRaises(ValueError):
                    self.capture()
                self.assertEqual(self.cluster.actions, [])

    def test_invalid_recipient_fails_before_pause(self):
        self.failure = "recipient"
        with self.assertRaises(ValueError):
            self.capture()
        self.assertEqual(self.cluster.actions, [])

    def test_configuration_rejects_cross_bucket_aliases_latest_versions_and_unsafe_identifiers(
        self,
    ):
        for changes in (
            {"project": "example-lab\nother"},
            {"zone": "us-central1-a"},
            {"recipient": "$(command)"},
            {"jwt_version": "latest"},
            {"run_id": "gh-123-1\nextra"},
            {"backups": self.configuration.snapshots},
            {"results": self.configuration.snapshots},
        ):
            with self.subTest(fields=tuple(changes)), self.assertRaises(ValueError):
                replace(self.configuration, **changes)

    def test_pause_uses_fresh_resource_version_and_atomic_patch_without_template_change(
        self,
    ):
        original = self.cluster.get("deployment", APPS[0])
        live = copy.deepcopy(original)
        live["metadata"]["resourceVersion"] = "2"
        calls = []

        def execute(command, *, data=None):
            if "get" in command:
                return json.dumps(live).encode()
            calls.append((command, json.loads(data)))
            return b""

        with patch("gke_auto_backup.run", side_effect=execute):
            Cluster(self.configuration).pause(APPS[0], original)
        command, operations = calls[0]
        self.assertIn("--type=json", command)
        self.assertEqual(
            operations[0],
            {"op": "test", "path": "/metadata/resourceVersion", "value": "2"},
        )
        self.assertFalse(
            any(op["path"].startswith("/spec/template") for op in operations)
        )
        self.assertEqual(
            operations[-1], {"op": "replace", "path": "/spec/replicas", "value": 0}
        )

    def test_pause_refuses_replaced_app_even_when_image_matches(self):
        original = self.cluster.get("deployment", APPS[0])
        changed = copy.deepcopy(original)
        changed["metadata"]["uid"] = "another-object"
        with patch(
            "gke_auto_backup.run", return_value=json.dumps(changed).encode()
        ) as execute:
            with self.assertRaisesRegex(ValueError, "changed before backup pause"):
                Cluster(self.configuration).pause(APPS[0], original)
        self.assertEqual(execute.call_count, 1)

    def test_partial_pause_failure_resumes_only_owned_unchanged_apps(self):
        self.cluster.fail_pause = APPS[0]
        with self.assertRaises(ValueError):
            self.capture()
        self.assertEqual(self.cluster.actions, [("pause", "web"), ("resume", "web")])
        self.assertTrue(
            all(
                obj["spec"]["replicas"] == 1
                for obj in self.cluster.deployments.values()
            )
        )

    def test_capture_encryption_and_upload_failures_resume_unchanged_previous_apps(
        self,
    ):
        for failure in ("capture", "encrypt", "upload"):
            with self.subTest(failure=failure):
                self.directory = Path(self.temporary.name) / failure
                self.directory.mkdir()
                self.cluster = ClusterFixture(self.configuration)
                self.failure = failure
                with self.assertRaises(ValueError):
                    self.capture()
                resumed = [
                    name for action, name in self.cluster.actions if action == "resume"
                ]
                self.assertEqual(resumed, list(APPS))
                self.assertTrue(
                    all(
                        obj["spec"]["replicas"] == 1
                        for obj in self.cluster.deployments.values()
                    )
                )

    def test_concurrent_config_template_owner_or_identity_change_blocks_blind_recovery(
        self,
    ):
        for failure in ("configuration", "template", "replacement", "foreign-owner"):
            with self.subTest(failure=failure):
                self.cluster = ClusterFixture(self.configuration)
                self.failure = failure
                with self.assertRaisesRegex(ValueError, "manual maintenance recovery"):
                    self.capture()
                self.assertFalse(
                    any(action == "resume" for action, _ in self.cluster.actions)
                )


if __name__ == "__main__":
    unittest.main()
