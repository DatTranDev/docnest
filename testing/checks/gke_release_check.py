"""Offline GKE release integrity tests; not cloud rollout/backup acceptance."""

import copy
from pathlib import Path
import sys
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tooling/scripts"))
from digest_manifest import NAMES
from gke_release_input import validate_inputs


class GkeReleaseTest(unittest.TestCase):
    def setUp(self):
        self.images = {
            name: f"asia-southeast1-docker.pkg.dev/example-lab/editor/{name}@sha256:"
            + "a" * 64
            for name in NAMES
        }
        self.release = {
            "commit": "b" * 40,
            "ref": "refs/heads/main",
            "nativeFormatVersion": 6,
            "googleClientId": "123-client.apps.googleusercontent.com",
            "images": self.images,
        }
        self.arguments = {
            "project": "example-lab",
            "region": "asia-southeast1",
            "commit": "b" * 40,
            "client_id": self.release["googleClientId"],
            "backups": "example-lab-gke-backups",
            "reference": "gs://example-lab-gke-backups/gke/pre-update-20261014.age",
            "require_release": True,
        }

    def test_accepts_bound_release_and_encrypted_object_reference(self):
        validate_inputs(self.images, self.release, **self.arguments)

    def test_rejects_mixed_commit_ref_native_client_or_image_metadata(self):
        for key, value in (
            ("commit", "c" * 40),
            ("ref", "refs/heads/other"),
            ("nativeFormatVersion", 5),
            ("googleClientId", "456-other.apps.googleusercontent.com"),
            ("images", {**self.images, "web": "mutable-tag"}),
        ):
            release = copy.deepcopy(self.release)
            release[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_inputs(self.images, release, **self.arguments)

    def test_rejects_missing_manifest_for_combined_build(self):
        with self.assertRaises(ValueError):
            validate_inputs(self.images, None, **self.arguments)
        validate_inputs(
            self.images, None, **{**self.arguments, "require_release": False}
        )

    def test_rejects_foreign_registry_or_incomplete_images(self):
        for images in (
            {
                **self.images,
                "web": self.images["web"].replace("example-lab", "other-lab"),
            },
            {key: value for key, value in self.images.items() if key != "web"},
        ):
            with self.subTest(images=tuple(images)), self.assertRaises(ValueError):
                validate_inputs(images, self.release, **self.arguments)

    def test_rejects_plaintext_wrong_bucket_signed_url_or_shell_metacharacters(self):
        for reference in (
            "gs://other-private-backups/gke/backup.age",
            "gs://example-lab-gke-backups/gke/backup.sql",
            "https://signed.example/backup.age?token=private",
            "gs://example-lab-gke-backups/gke/backup.age\nextra",
            "gs://example-lab-gke-backups/gke/$(command).age",
        ):
            with (
                self.subTest(kind=reference.split(":", 1)[0]),
                self.assertRaises(ValueError),
            ):
                validate_inputs(
                    self.images,
                    self.release,
                    **{**self.arguments, "reference": reference},
                )

    def test_manual_workflow_chains_same_build_outputs_into_protected_gke_deploy(self):
        workflow = yaml.load(
            (ROOT / ".github/workflows/gke-build-deploy.yml").read_text(),
            Loader=yaml.BaseLoader,
        )
        self.assertEqual(set(workflow["on"]), {"workflow_dispatch"})
        self.assertEqual(workflow["concurrency"]["cancel-in-progress"], "false")
        jobs = workflow["jobs"]
        self.assertEqual(jobs["build"]["uses"], "./.github/workflows/cloud-images.yml")
        self.assertEqual(jobs["deploy"]["needs"], "build")
        self.assertEqual(jobs["deploy"]["uses"], "./.github/workflows/cloud-deploy.yml")
        for job in jobs.values():
            self.assertEqual(job["with"]["environment_name"], "cloud-gke")
        self.assertEqual(
            jobs["deploy"]["with"]["release_json"],
            "${{ needs.build.outputs.release_json }}",
        )
        self.assertEqual(
            jobs["deploy"]["with"]["image_digests"],
            "${{ needs.build.outputs.image_digests }}",
        )
        publish = yaml.load(
            (ROOT / ".github/workflows/cloud-images.yml").read_text(),
            Loader=yaml.BaseLoader,
        )
        self.assertEqual(
            publish["on"]["workflow_call"]["inputs"]["environment_name"]["default"],
            "cloud-lab",
        )
        self.assertEqual(
            set(publish["on"]["workflow_call"]["outputs"]),
            {"image_digests", "release_json"},
        )


if __name__ == "__main__":
    unittest.main()
