"""Offline selective release policy tests; no live rollout or restore claims."""

import copy
import itertools
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tooling/scripts"))
from detect_affected import BACKENDS, affected, resolve, selection
from digest_manifest import NAMES, validate_manifest
from release_manifest import merge_state, scan_records
from rolling_policy import validate_compatibility
from routine_release import plan, validate_live
from routine_rollout import verify_unrelated
from service_config import CONFIG_KEYS, config_hash


class ImpactTests(unittest.TestCase):
    def test_editor_design_document_is_not_a_wire_contract(self):
        document = "docs/04_EDITOR_ENGINE.md"
        self.assertEqual(affected([document])["images"], [])
        self.assertFalse(affected([document])["coordinated"])
        for contract in (
            "docs/contracts/openapi.yaml",
            "docs/contracts/events/document.version.saved.v1.schema.json",
            "docs/contracts/native-manifest.schema.json",
            "backend/common/src/main/java/vn/editor/common/codec/NativeCodec.java",
            "backend/common/src/main/java/vn/editor/common/contracts/Envelope.java",
        ):
            with self.subTest(contract=contract):
                impact = affected([document, contract])
                self.assertEqual(impact["images"], list(NAMES))
                self.assertTrue(impact["coordinated"])
                with self.assertRaisesRegex(ValueError, "Protocol/native changes"):
                    validate_compatibility(impact)

    def test_real_git_editor_document_and_ui_pass_release_planning(self):
        previous = Path.cwd()
        with tempfile.TemporaryDirectory() as temporary:
            os.chdir(temporary)
            try:

                def git(*args):
                    return subprocess.check_output(
                        ["git", *args], stderr=subprocess.DEVNULL, text=True
                    ).strip()

                def commit(message):
                    git("add", "-A")
                    git("commit", "-m", message)
                    return git("rev-parse", "HEAD")

                def release(base, head):
                    with patch.dict(
                        os.environ, {"GITHUB_SHA": head, "GOOGLE_CLIENT_ID": ""}
                    ):
                        return plan({"commit": base, "googleClientId": ""})

                git("init", "-b", "main")
                git("config", "user.email", "fixture@example.invalid")
                git("config", "user.name", "Release policy fixture")
                document = Path("docs/04_EDITOR_ENGINE.md")
                document.parent.mkdir(parents=True)
                document.write_text("Existing native format specification.\n")
                ui = Path("frontend/web/src/features/editor/components/EditorPane.tsx")
                ui.parent.mkdir(parents=True)
                ui.write_text("export const label = 'Editor';\n")
                baseline = commit("deployed baseline")
                document.write_text(
                    "Existing native format specification.\n"
                    "Image resizing changes resolution and supports undo.\n"
                )
                doc_head = commit("describe image sizing UI")
                impact = release(baseline, doc_head)
                self.assertEqual(impact["images"], [])
                self.assertEqual(impact["applications"], [])
                self.assertFalse(impact["coordinated"])
                ui.write_text("export const label = 'Image size';\n")
                ui_head = commit("add image sizing UI")
                impact = release(baseline, ui_head)
                self.assertEqual(impact["images"], ["web"])
                self.assertEqual(impact["applications"], ["web"])
                self.assertEqual(impact["migrations"], [])
                self.assertFalse(impact["coordinated"])
                contract = Path("docs/contracts/native-manifest.schema.json")
                contract.parent.mkdir(parents=True)
                contract.write_text('{"type":"object"}\n')
                contract_head = commit("change native contract alongside docs and UI")
                with self.assertRaisesRegex(ValueError, "Protocol/native changes"):
                    release(baseline, contract_head)
                contract.rename(Path("docs/archived-native-schema.json"))
                moved_head = commit("move native contract out of contract directory")
                with self.assertRaisesRegex(ValueError, "Protocol/native changes"):
                    release(contract_head, moved_head)
            finally:
                os.chdir(previous)

    def test_document_only_and_schema_scope(self):
        impact = affected(["backend/document-service/src/main/java/Example.java"])
        self.assertEqual(impact["images"], ["document-service"])
        self.assertEqual(impact["migrations"], [])
        impact = affected(["backend/schema/document/V9__expand.sql"])
        self.assertEqual(impact["migrations"], ["document-service"])
        self.assertEqual(impact["images"], ["document-service"])

    def test_shared_native_frontend_and_unknown_inputs(self):
        self.assertEqual(affected(["backend/common/pom.xml"])["images"], list(BACKENDS))
        for path in (
            "backend/common/src/main/java/vn/editor/common/codec/NativeCodec.java",
            "docs/contracts/events/example.json",
        ):
            result = affected([path])
            self.assertEqual(result["images"], list(NAMES))
            self.assertTrue(result["coordinated"])
        self.assertEqual(
            affected(["frontend/editor-core/src/model.ts"])["images"], ["web"]
        )
        self.assertEqual(affected(["docs/GKE_ONE_CLICK.md"])["images"], [])
        self.assertEqual(affected(["unknown-config"])["images"], list(NAMES))
        result = affected(["infra/k8s/base/document-service.yaml"])
        self.assertEqual(result["images"], [])
        self.assertEqual(result["applications"], ["document-service"])

    def test_selection_rejects_unknown_duplicate_and_shell_inputs(self):
        for values in (["mysql"], ["web", "web"], ["web; echo unsafe"], "web", [None]):
            with self.subTest(values=values), self.assertRaises(ValueError):
                selection(values)

    def test_real_git_merge_base_rename_delete_and_missing_history(self):
        previous = Path.cwd()
        with tempfile.TemporaryDirectory() as temporary:
            os.chdir(temporary)
            try:

                def git(*args):
                    return (
                        subprocess.check_output(
                            ["git", *args], stderr=subprocess.DEVNULL
                        )
                        .decode()
                        .strip()
                    )

                git("init", "-b", "main")
                git("config", "user.email", "fixture@example.invalid")
                git("config", "user.name", "Release policy fixture")
                original = Path("backend/document-service/old.java")
                original.parent.mkdir(parents=True)
                original.write_text("fixture")
                git("add", ".")
                git("commit", "-m", "base")
                base = git("rev-parse", "HEAD")
                git("checkout", "-b", "feature")
                moved = Path("backend/identity-service/new.java")
                moved.parent.mkdir(parents=True)
                original.rename(moved)
                git("add", "-A")
                git("commit", "-m", "move")
                feature = git("rev-parse", "HEAD")
                git("checkout", "main")
                Path("README.md").write_text("base branch only")
                git("add", ".")
                git("commit", "-m", "advance base")
                result = resolve("main", feature)
                self.assertEqual(result["base"], base)
                self.assertEqual(
                    result["images"], ["identity-service", "document-service"]
                )
                git("checkout", "feature")
                moved.unlink()
                git("add", "-A")
                git("commit", "-m", "delete")
                self.assertEqual(resolve(feature)["images"], ["identity-service"])
                migration = Path("backend/schema/document/V1__existing.sql")
                migration.parent.mkdir(parents=True)
                migration.write_text("CREATE TABLE fixture(id INT);")
                git("add", ".")
                git("commit", "-m", "migration")
                applied = git("rev-parse", "HEAD")
                migration.write_text("CREATE TABLE fixture(id BIGINT);")
                git("add", ".")
                git("commit", "-m", "invalid rewrite")
                with self.assertRaises(ValueError):
                    resolve(applied)
                self.assertEqual(resolve(None)["images"], list(NAMES))
                with self.assertRaises(subprocess.CalledProcessError):
                    resolve("missing-ref")
            finally:
                os.chdir(previous)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.repository = "https://github.com/example/docnest"
        self.run = self.repository + "/actions/runs/123"
        self.images = {
            name: f"asia-southeast1-docker.pkg.dev/example-lab/editor/{name}@sha256:"
            + "a" * 64
            for name in NAMES
        }
        self.state = {
            "schemaVersion": 2,
            "environment": "cloud-gke",
            "nativeFormatVersion": 6,
            "ref": "refs/heads/main",
            "commit": "b" * 40,
            "googleClientId": "client",
            "images": self.images,
            "imageProvenance": {
                name: {
                    "image": image,
                    "commit": "b" * 40,
                    "runUrl": self.run,
                    "scan": {
                        "highCriticalGate": "PASS",
                        "secretGate": "PASS",
                        "evidenceSha256": "d" * 64,
                        "imageId": "sha256:" + "e" * 64,
                    },
                }
                for name, image in self.images.items()
            },
        }
        self.build = copy.deepcopy(self.state)
        self.build.update(commit="c" * 40, runUrl=self.run)
        self.build["images"] = {
            "document-service": self.images["document-service"].replace(
                "a" * 64, "f" * 64
            )
        }
        self.build["imageProvenance"] = {
            "document-service": {
                **self.state["imageProvenance"]["document-service"],
                "commit": "c" * 40,
                "image": self.build["images"]["document-service"],
            }
        }

    def merge(self, build=None):
        return merge_state(
            self.state,
            build or self.build,
            project="example-lab",
            region="asia-southeast1",
            repository=self.repository,
            commit="c" * 40,
            run_url=self.run,
        )

    def test_partial_merge_preserves_unaffected_digests_and_provenance(self):
        result = self.merge()
        self.assertEqual(
            result["images"]["document-service"],
            self.build["images"]["document-service"],
        )
        for name in NAMES:
            if name != "document-service":
                self.assertEqual(result["images"][name], self.state["images"][name])
                self.assertEqual(
                    result["imageProvenance"][name], self.state["imageProvenance"][name]
                )
        with self.assertRaises(ValueError):
            validate_manifest(self.build["images"], "example-lab", "asia-southeast1")
        validate_manifest(
            self.build["images"], "example-lab", "asia-southeast1", partial=True
        )

    def test_rejects_wrong_commit_registry_scan_and_client(self):
        mutations = [
            lambda value: value.update(commit="d" * 40),
            lambda value: value.update(googleClientId="other"),
            lambda value: value["images"].update(mysql="invalid"),
            lambda value: value["imageProvenance"]["document-service"].update(
                commit="d" * 40
            ),
            lambda value: value["imageProvenance"]["document-service"]["scan"].update(
                highCriticalGate="FAIL"
            ),
            lambda value: value["imageProvenance"]["document-service"].update(
                runUrl="https://foreign.invalid/actions/runs/123"
            ),
        ]
        for mutate in mutations:
            value = copy.deepcopy(self.build)
            mutate(value)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                self.merge(value)

    def test_public_config_dependencies_cover_service_property_inputs(self):
        config = yaml.safe_load(
            (ROOT / "infra/k8s/base/config.yaml").read_text(encoding="utf-8")
        )["data"]
        for name in BACKENDS:
            text = "\n".join(
                path.read_text(encoding="utf-8")
                for path in (ROOT / "backend" / name / "src/main/resources").glob(
                    "application*.yml"
                )
            )
            referenced = set(re.findall(r"\$\{([A-Z][A-Z0-9_]*)", text)) & set(config)
            self.assertLessEqual(referenced, CONFIG_KEYS[name], name)

    def test_only_consuming_configuration_changes(self):
        config = {
            "MAX_USERS": "10",
            "STRIPE_PRO_MONTHLY_PRICE": "price_A",
            "JWT_ISSUER": "https://example.invalid",
        }
        changed = {**config, "MAX_USERS": "20"}
        for name in NAMES:
            self.assertEqual(
                config_hash(name, config) != config_hash(name, changed),
                name == "identity-service",
            )

    def test_scan_evidence_requires_complete_identical_images(self):
        previous = Path.cwd()
        with tempfile.TemporaryDirectory() as temporary:
            os.chdir(temporary)
            try:
                Path("testing/reports").mkdir(parents=True)
                ref, image_id = (
                    "text-editor/document-service:local",
                    "sha256:" + "a" * 64,
                )
                secret = {
                    "status": "PASS",
                    "images": [{"image": ref, "imageId": image_id}],
                }
                scan = {
                    "highCriticalGate": "PASS",
                    "requiredImages": [ref],
                    "pendingImages": [],
                    "scans": [
                        {
                            "reference": ref,
                            "imageId": image_id,
                            "highCriticalGate": "PASS",
                        }
                    ],
                }
                Path("testing/reports/image-secrets.json").write_text(
                    json.dumps(secret)
                )
                target = Path("testing/reports/image-os-scan.json")
                target.write_text(json.dumps(scan))
                self.assertEqual(
                    scan_records(["document-service"])["document-service"]["imageId"],
                    image_id,
                )
                scan["scans"][0]["imageId"] = "sha256:" + "b" * 64
                target.write_text(json.dumps(scan))
                with self.assertRaises(ValueError):
                    scan_records(["document-service"])
                target.write_text(json.dumps({**scan, "pendingImages": [ref]}))
                with self.assertRaises(ValueError):
                    scan_records(["document-service"])
            finally:
                os.chdir(previous)

    def test_unrelated_pod_restart_is_rejected(self):
        before = {
            "deployments": {
                name: {"image": image} for name, image in self.images.items()
            },
            "pods": [["identity-service", "old"]],
        }
        after = copy.deepcopy(before)
        after["deployments"]["document-service"]["image"] = "new"
        verify_unrelated(before, after, ["document-service"])
        after["pods"][0][1] = "new"
        with self.assertRaises(ValueError):
            verify_unrelated(before, after, ["document-service"])

    def test_generator_reproduces_application_resources(self):
        with tempfile.TemporaryDirectory() as temporary:
            subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "tooling/scripts/generate_k8s.py"),
                    "--applications-only",
                    "--output-root",
                    temporary,
                ],
                check=True,
                capture_output=True,
            )
            for name in NAMES:
                paths = [name + ".yaml"] + (
                    [] if name == "web" else ["migrate-" + name + ".yaml"]
                )
                for filename in paths:
                    actual = list(
                        yaml.safe_load_all(
                            (Path(temporary) / "base" / filename).read_text(
                                encoding="utf-8"
                            )
                        )
                    )
                    expected = list(
                        yaml.safe_load_all(
                            (ROOT / "infra/k8s/base" / filename).read_text(
                                encoding="utf-8"
                            )
                        )
                    )
                    self.assertEqual(actual, expected, filename)

    def test_live_state_rejects_drift_unhealthy_or_paused_apps(self):
        live = {
            "pods": [],
            "deployments": {
                name: {
                    "metadata": {"uid": name, "generation": 3},
                    "spec": {
                        "replicas": 1,
                        "template": {"spec": {"containers": [{"image": image}]}},
                    },
                    "status": {
                        "readyReplicas": 1,
                        "availableReplicas": 1,
                        "updatedReplicas": 1,
                        "replicas": 1,
                        "observedGeneration": 3,
                    },
                }
                for name, image in self.images.items()
            },
        }
        validate_live(self.state, live)
        for mutate in (
            lambda obj: obj["spec"].update(replicas=0),
            lambda obj: obj["status"].update(readyReplicas=0),
            lambda obj: obj["status"].update(observedGeneration=2),
            lambda obj: obj["spec"]["template"]["spec"]["containers"][0].update(
                image="foreign"
            ),
            lambda obj: obj["metadata"].update(
                annotations={"docsnest.dattrandev.id.vn/backup-run": "other"}
            ),
        ):
            changed = copy.deepcopy(live)
            mutate(changed["deployments"]["document-service"])
            with self.assertRaises(ValueError):
                validate_live(self.state, changed)

    def test_ci_aggregate_executes_status_matrix(self):
        workflow = yaml.safe_load(
            (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
        )
        script = workflow["jobs"]["application"]["steps"][0]["run"]
        bash = (
            str(
                Path(os.environ.get("ProgramFiles", "C:/Program Files"))
                / "Git/bin/bash.exe"
            )
            if os.name == "nt"
            else "bash"
        )
        for web, backends in itertools.product(
            ("true", "false"), ("[]", '["document-service"]')
        ):
            for java, app in itertools.product(
                ("success", "failure", "cancelled", "skipped"), repeat=2
            ):
                env = {
                    **os.environ,
                    "CHANGES_RESULT": "success",
                    "BACKENDS": backends,
                    "WEB": web,
                    "BACKEND_RESULT": java,
                    "FRONTEND_RESULT": app,
                }
                result = subprocess.run(
                    [bash, "-c", script], env=env, capture_output=True
                )
                expected = java == (
                    "skipped" if backends == "[]" else "success"
                ) and app == ("success" if web == "true" else "skipped")
                self.assertEqual(
                    result.returncode == 0,
                    expected,
                    (web, backends, java, app),
                )
        for status in ("failure", "cancelled", "skipped"):
            result = subprocess.run(
                [bash, "-c", script],
                env={**env, "CHANGES_RESULT": status},
                capture_output=True,
            )
            self.assertNotEqual(result.returncode, 0)

    def test_routine_workflow_has_shared_lock_and_no_maintenance_helper(self):
        workflow = yaml.safe_load(
            (ROOT / ".github/workflows/gke-build-deploy.yml").read_text(
                encoding="utf-8"
            )
        )
        deploy = workflow["jobs"]["deploy"]
        self.assertEqual(
            workflow["concurrency"],
            {"group": "cloud-gke-deployment", "cancel-in-progress": False},
        )
        runs = "\n".join(step.get("run", "") for step in deploy["steps"])
        self.assertNotIn("gke_auto_backup.py", runs)
        self.assertNotIn("scale", runs)
        for name in NAMES:
            docs = list(
                yaml.safe_load_all(
                    (ROOT / f"infra/k8s/base/{name}.yaml").read_text(encoding="utf-8")
                )
            )
            deployment = next(obj for obj in docs if obj["kind"] == "Deployment")
            self.assertEqual(
                deployment["spec"]["strategy"]["rollingUpdate"],
                {"maxSurge": 1, "maxUnavailable": 0},
            )
            pod = deployment["spec"]["template"]["spec"]
            self.assertGreaterEqual(pod["terminationGracePeriodSeconds"], 160)
            self.assertEqual(
                pod["containers"][0]["lifecycle"]["preStop"]["exec"]["command"],
                ["/bin/sh", "-c", "sleep 210" if name == "web" else "sleep 10"],
            )


if __name__ == "__main__":
    unittest.main()
