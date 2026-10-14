"""Offline VM release validation and fault-order tests; no cloud deployment proof."""

import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tooling/scripts"))
import vm_release


def config():
    return {
        "project": "example-project",
        "region": "us-central1",
        "origin": "https://editor.example.com",
        "backups_bucket": "example-private-backups",
        "jwt_version": "1",
        "age_recipient": "age1" + "q" * 58,
    }


class SimulatedRollout(vm_release.Rollout):
    """Fault injection into orchestration only, not a substitute for real storage."""

    def __init__(self, root, *, fail=None, changed=False):
        self.root = root
        self.fail = fail
        self.changed = changed
        self.events = []

    def capture_previous(self):
        return {
            "commit": "previous",
            "source": "previous",
            "images": {},
            "env": "previous.env",
        }

    def compose(self, release, *arguments):
        self.events.append((release["commit"], arguments))
        if arguments[0] == "run" and self.fail == "migration":
            raise ValueError("Injected migration failure")

    def backup(self, previous, directory):
        self.events.append(("backup", ()))
        if self.fail == "backup":
            raise ValueError("Injected backup failure")
        return {"identity_db": []}, "gs://example-private-backups/test.age"

    def start(self, release):
        self.events.append(("start", (release["commit"],)))
        if release["commit"] != "previous" and self.fail == "health":
            raise ValueError("Injected readiness failure")

    def histories(self, release):
        return {"identity_db": [{"version": "new"}] if self.changed else []}


class VmReleaseTest(unittest.TestCase):
    def test_config_rejects_secrets_as_recipient_and_wrong_origin(self):
        vm_release.validate_config(config())
        for key, value in (
            ("age_recipient", "AGE-SECRET-KEY-private"),
            ("origin", "http://editor.example.com"),
            ("jwt_version", "latest"),
            ("backups_bucket", "public/bucket"),
        ):
            with self.subTest(key=key), self.assertRaises(ValueError):
                vm_release.validate_config({**config(), key: value})

    def test_archive_cannot_escape_or_link_into_protected_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, kind in (
                ("../../cloud.env", tarfile.REGTYPE),
                ("/etc/shadow", tarfile.REGTYPE),
                ("key", tarfile.SYMTYPE),
                ("key", tarfile.LNKTYPE),
            ):
                with self.subTest(name=name, kind=kind):
                    archive_path = root / "archive.tar.gz"
                    with tarfile.open(archive_path, "w:gz") as archive:
                        item = tarfile.TarInfo(name)
                        item.type = kind
                        item.linkname = "/etc/shadow"
                        archive.addfile(item)
                    with self.assertRaises(ValueError):
                        vm_release.unpack(archive_path, root / "release")

    def test_actual_tar_extracts_bounded_regular_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with tarfile.open(root / "archive.tar.gz", "w:gz") as archive:
                item = tarfile.TarInfo("infra/test.txt")
                item.size = 5
                archive.addfile(item, io.BytesIO(b"hello"))
            vm_release.unpack(root / "archive.tar.gz", root / "release")
            self.assertEqual((root / "release/infra/test.txt").read_bytes(), b"hello")

    def test_rollout_backups_before_all_five_migrations_and_saves_state(self):
        with tempfile.TemporaryDirectory() as directory:
            rollout = SimulatedRollout(Path(directory))
            rollout.deploy(
                {"commit": "a" * 40, "source": "new", "env": "new.env", "images": {}}
            )
            migrations = [
                event for event in rollout.events if event[1] and event[1][0] == "run"
            ]
            self.assertEqual(
                [event[1][-2] for event in migrations], list(vm_release.NAMES[:-1])
            )
            self.assertLess(
                rollout.events.index(("backup", ())),
                rollout.events.index(migrations[0]),
            )
            self.assertGreater(
                rollout.events.index(("start", ("a" * 40,))),
                rollout.events.index(migrations[-1]),
            )
            state = json.loads((Path(directory) / "vm-state.json").read_text())
            self.assertEqual(state["previous"]["commit"], "previous")

    def test_backup_failure_recovers_previous_apps_and_never_migrates(self):
        with tempfile.TemporaryDirectory() as directory:
            rollout = SimulatedRollout(Path(directory), fail="backup")
            with self.assertRaises(ValueError):
                rollout.deploy({"commit": "a" * 40})
            self.assertIn(("start", ("previous",)), rollout.events)
            self.assertFalse(
                any(event[1] and event[1][0] == "run" for event in rollout.events)
            )
            self.assertFalse((Path(directory) / "vm-state.json").exists())

    def test_migration_failure_requires_manual_recovery_when_schema_changed(self):
        for changed in (False, True):
            with (
                self.subTest(changed=changed),
                tempfile.TemporaryDirectory() as directory,
            ):
                rollout = SimulatedRollout(
                    Path(directory), fail="migration", changed=changed
                )
                with self.assertRaises(ValueError):
                    rollout.deploy({"commit": "a" * 40})
                self.assertEqual(
                    ("start", ("previous",)) in rollout.events, not changed
                )

    def test_health_failure_recovers_unchanged_schema(self):
        with tempfile.TemporaryDirectory() as directory:
            rollout = SimulatedRollout(Path(directory), fail="health")
            with self.assertRaises(ValueError):
                rollout.deploy({"commit": "a" * 40})
            self.assertIn(("start", ("previous",)), rollout.events)

    def test_failure_output_does_not_leak_command_output(self):
        completed = type(
            "Result",
            (),
            {"returncode": 1, "stdout": b"secret", "stderr": b"private-key"},
        )()
        with patch("vm_release.subprocess.run", return_value=completed):
            with self.assertRaises(ValueError) as error:
                vm_release.execute(["some-command"])
        self.assertNotIn("secret", str(error.exception))
        self.assertNotIn("private-key", str(error.exception))


if __name__ == "__main__":
    unittest.main()
