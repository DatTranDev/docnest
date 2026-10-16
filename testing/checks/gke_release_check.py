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
        self.assertEqual(jobs["configuration"]["environment"], "cloud-gke")
        self.assertEqual(jobs["build"]["needs"], "configuration")
        self.assertNotIn("inputs", workflow["on"]["workflow_dispatch"] or {})
        self.assertEqual(jobs["deploy"]["with"]["automatic_backup"], "true")
        self.assertNotIn("backup_reference", jobs["deploy"]["with"])
        for job in (jobs["build"], jobs["deploy"]):
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
            "cloud-gke",
        )
        self.assertEqual(
            set(publish["on"]["workflow_call"]["outputs"]),
            {"image_digests", "release_json"},
        )

    def test_active_cloud_workflows_reject_retired_vm_environment(self):
        self.assertFalse((ROOT / ".github/workflows/vm-build-deploy.yml").exists())
        for name, job in (
            ("cloud-images.yml", "images"),
            ("cloud-deploy.yml", "deploy"),
        ):
            workflow = yaml.load(
                (ROOT / ".github/workflows" / name).read_text(), Loader=yaml.BaseLoader
            )
            with self.subTest(workflow=name):
                dispatch = workflow["on"]["workflow_dispatch"]["inputs"][
                    "environment_name"
                ]
                self.assertEqual(dispatch["options"], ["cloud-gke"])
                self.assertEqual(dispatch["default"], "cloud-gke")
                self.assertEqual(
                    workflow["on"]["workflow_call"]["inputs"]["environment_name"][
                        "default"
                    ],
                    "cloud-gke",
                )
                self.assertEqual(
                    workflow["jobs"][job]["if"],
                    "github.ref == 'refs/heads/main' && inputs.environment_name == 'cloud-gke'",
                )

    def test_automatic_backup_keeps_validation_backup_and_mutations_in_one_deployment_lock(
        self,
    ):
        workflow = yaml.load(
            (ROOT / ".github/workflows/cloud-deploy.yml").read_text(),
            Loader=yaml.BaseLoader,
        )
        self.assertEqual(workflow["concurrency"]["group"], "cloud-gke-deployment")
        self.assertEqual(
            workflow["on"]["workflow_call"]["inputs"]["automatic_backup"]["default"],
            "false",
        )
        self.assertEqual(
            workflow["on"]["workflow_dispatch"]["inputs"]["backup_reference"][
                "required"
            ],
            "true",
        )
        steps = workflow["jobs"]["deploy"]["steps"]
        runs = "\n".join(step.get("run", "") for step in steps)
        self.assertLess(
            runs.index("kubectl apply --dry-run=server"),
            runs.index("gke_auto_backup.py capture"),
        )
        self.assertLess(
            runs.index("gke_auto_backup.py capture"),
            runs.index("gcloud storage objects describe"),
        )
        self.assertLess(
            runs.index("gcloud storage objects describe"),
            runs.index("kubectl apply -f cloud-render/config.yaml"),
        )
        self.assertLess(
            runs.index("kubectl apply -f cloud-render/web.yaml"),
            runs.index("gke_auto_backup.py complete"),
        )
        backup_auth = next(
            i
            for i, step in enumerate(steps)
            if step.get("name") == "Authenticate dedicated backup identity"
        )
        deploy_auth = next(
            i
            for i, step in enumerate(steps)
            if step.get("name") == "Restore scoped deploy identity after backup"
        )
        self.assertEqual(
            steps[backup_auth]["with"]["service_account"],
            "${{ vars.GCP_BACKUP_SERVICE_ACCOUNT }}",
        )
        self.assertEqual(
            steps[deploy_auth]["with"]["service_account"],
            "${{ vars.GCP_DEPLOY_SERVICE_ACCOUNT }}",
        )
        capture_index = next(
            i
            for i, step in enumerate(steps)
            if "gke_auto_backup.py capture" in step.get("run", "")
        )
        self.assertLess(backup_auth, capture_index)
        self.assertLess(capture_index, deploy_auth)
        artifact = next(
            step
            for step in steps
            if step.get("uses", "").startswith("actions/upload-artifact@")
        )
        self.assertEqual(artifact["with"]["path"], "deployment-evidence/")

    def test_backup_permissions_are_named_and_separate_from_deployment(self):
        objects = list(
            yaml.safe_load_all(
                (ROOT / "infra/k8s/backup-rbac.example.yaml").read_text()
            )
        )
        role = next(obj for obj in objects if obj["kind"] == "Role")
        self.assertEqual(role["metadata"]["namespace"], "editor-lab")
        rules = role["rules"]
        secret = next(rule for rule in rules if rule["resources"] == ["secrets"])
        self.assertEqual(secret["resourceNames"], ["editor-jwt"])
        self.assertEqual(secret["verbs"], ["get"])
        execute = next(rule for rule in rules if rule["resources"] == ["pods/exec"])
        self.assertEqual(execute["resourceNames"], ["mysql-0"])
        self.assertEqual(set(execute["verbs"]), {"get", "create"})
        self.assertTrue(
            all(
                "*" not in rule["resources"] and "*" not in rule["verbs"]
                for rule in rules
            )
        )
        deploy_role = next(
            yaml.safe_load_all(
                (ROOT / "infra/k8s/deploy-rbac.example.yaml").read_text()
            )
        )
        self.assertFalse(
            any(
                "secrets" in rule["resources"] or "pods/exec" in rule["resources"]
                for rule in deploy_role["rules"]
            )
        )
        script = (ROOT / "tooling/scripts/setup_gke_backup.sh").read_text()
        self.assertIn("roles/storage.objectCreator", script)
        self.assertNotIn("roles/storage.admin", script)
        self.assertNotIn("roles/editor", script)


if __name__ == "__main__":
    unittest.main()
