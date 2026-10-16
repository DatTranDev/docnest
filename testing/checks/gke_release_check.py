"""Release orchestration and real HTTP artifact transport tests; not GKE acceptance."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import sys
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.request
import zipfile

import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tooling/scripts"))
from deployment_state import Actions, ArtifactRedirect, LIMIT, discover, read_state
from digest_manifest import NAMES
from rolling_policy import migration_hash, validate_compatibility, validate_policy
from routine_release import configuration_scope, evidence_inventory, plan, prepare
from routine_rollout import verify_unrelated
from service_config import config_hash


def bundle(state):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr("environment-state.json", json.dumps(state))
    return stream.getvalue()


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.state = {"rolloutStatus": "PASS", "commit": "a" * 40}
        self.run = {
            "id": 42,
            "path": ".github/workflows/gke-build-deploy.yml",
            "head_branch": "main",
            "event": "workflow_dispatch",
            "status": "completed",
            "conclusion": "success",
            "head_sha": "a" * 40,
        }
        self.artifact = {"id": 7, "name": "deployment-evidence", "expired": False}
        self.routes = {}
        self.requests = []
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                fixture.requests.append((self.path, self.headers.get("Authorization")))
                data = fixture.routes.get(self.path)
                self.send_response(200 if data is not None else 503)
                self.end_headers()
                if data is not None:
                    self.wfile.write(
                        data if isinstance(data, bytes) else json.dumps(data).encode()
                    )

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        with patch.dict(os.environ, {"GITHUB_REPOSITORY": "example/docnest"}):
            self.actions = Actions()
        self.actions.base = f"http://127.0.0.1:{self.server.server_port}/"
        self.routes["/actions/runs?branch=main&per_page=100&page=1"] = {
            "workflow_runs": [self.run]
        }
        self.routes["/actions/runs/42/artifacts?per_page=100&page=1"] = {
            "artifacts": [self.artifact]
        }
        self.routes["/actions/artifacts/7/zip"] = bundle(self.state)
        self.environment = patch.dict(os.environ, {"GH_TOKEN": "fixture-token"})
        self.environment.start()

    def tearDown(self):
        self.environment.stop()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_discovers_state_over_actual_http_and_filters_foreign_runs(self):
        rows = self.routes["/actions/runs?branch=main&per_page=100&page=1"][
            "workflow_runs"
        ]
        rows[:0] = [
            {**self.run, "id": 100},
            {**self.run, "id": 99, "head_branch": "untrusted"},
            {**self.run, "id": 98, "event": "pull_request"},
            {**self.run, "id": 97, "path": ".github/workflows/untrusted.yml"},
        ]
        self.assertEqual(discover(self.actions, "100"), self.state)
        self.assertEqual(len(self.requests), 3)
        self.assertTrue(
            all(auth == "Bearer fixture-token" for _, auth in self.requests)
        )

    def test_paginates_runs_and_artifacts(self):
        first = "/actions/runs?branch=main&per_page=100&page=1"
        self.routes[first] = {"workflow_runs": [{**self.run, "path": "ignored"}] * 100}
        self.routes[first.replace("&page=1", "&page=2")] = {"workflow_runs": [self.run]}
        first = "/actions/runs/42/artifacts?per_page=100&page=1"
        self.routes[first] = {"artifacts": [{**self.artifact, "name": "ignored"}] * 100}
        self.routes[first.replace("&page=1", "&page=2")] = {
            "artifacts": [self.artifact]
        }
        self.assertEqual(discover(self.actions, "100"), self.state)

    def test_bootstrap_only_when_no_deployment_state_is_available(self):
        self.artifact["expired"] = True
        self.assertIsNone(discover(self.actions, "100"))
        self.artifact["expired"] = False
        self.routes["/actions/artifacts/7/zip"] = b"corrupt archive"
        with self.assertRaises(zipfile.BadZipFile):
            discover(self.actions, "100")

    def test_failed_or_partial_mutation_never_becomes_baseline(self):
        for change in (
            {"rolloutStatus": "PENDING", "mutationStarted": True},
            {"commit": "b" * 40},
        ):
            self.routes["/actions/artifacts/7/zip"] = bundle({**self.state, **change})
            with self.subTest(change=change), self.assertRaises(ValueError):
                discover(self.actions, "100")
        self.routes["/actions/artifacts/7/zip"] = bundle(self.state)
        self.run["conclusion"] = "failure"
        with self.assertRaises(ValueError):
            discover(self.actions, "100")

    def test_preflight_failure_is_safe_to_retry_but_pending_release_is_not(self):
        self.routes["/actions/artifacts/7/zip"] = bundle(
            {"rolloutStatus": "PENDING", "mutationStarted": False}
        )
        self.assertIsNone(discover(self.actions, "100"))
        self.run["status"] = "in_progress"
        with self.assertRaises(ValueError):
            discover(self.actions, "100")

    def test_rerunning_same_actions_run_cannot_hide_an_interrupted_mutation(self):
        self.routes["/actions/artifacts/7/zip"] = bundle(
            {"rolloutStatus": "PENDING", "mutationStarted": True}
        )
        with self.assertRaisesRegex(ValueError, "reconcile before retry"):
            discover(self.actions, "42", attempt=2)
        self.routes["/actions/artifacts/7/zip"] = bundle(self.state)
        self.assertEqual(discover(self.actions, "42", attempt=2), self.state)

    def test_transport_failure_does_not_become_full_build_or_log_private_url(self):
        self.routes.clear()
        with self.assertRaisesRegex(
            ValueError, "Cannot read deployment history"
        ) as error:
            discover(self.actions, "100")
        self.assertNotIn("fixture-token", str(error.exception))
        self.routes["/too-large"] = b"x" * (LIMIT + 1)
        with self.assertRaisesRegex(ValueError, "size limit"):
            self.actions.request("too-large", binary=True)

    def test_signed_artifact_redirect_drops_authorization(self):
        request = urllib.request.Request(
            "https://api.github.com/evidence",
            headers={"Authorization": "Bearer fixture-token"},
        )
        redirect = ArtifactRedirect().redirect_request(
            request, None, 302, "", {}, "https://storage.example.invalid/signed"
        )
        self.assertIsNone(redirect.get_header("Authorization"))
        with self.assertRaises(ValueError):
            ArtifactRedirect().redirect_request(
                request, None, 302, "", {}, "http://storage.example.invalid/signed"
            )

    def test_zip_duplicate_and_oversize_state_are_rejected_without_extraction(self):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("environment-state.json", "x" * (LIMIT + 1))
        with self.assertRaises(ValueError):
            read_state(stream.getvalue())
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as archive:
            archive.writestr("environment-state.json", "{}")
            with self.assertWarns(UserWarning):
                archive.writestr("environment-state.json", "{}")
        with self.assertRaises(ValueError):
            read_state(stream.getvalue())


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.images = {
            name: f"asia-southeast1-docker.pkg.dev/example-lab/editor/{name}@sha256:"
            + "a" * 64
            for name in NAMES
        }
        self.live = {
            "pods": [],
            "deployments": {
                name: {
                    "metadata": {"uid": name, "generation": 1},
                    "spec": {
                        "replicas": 1,
                        "template": {
                            "metadata": {
                                "annotations": {
                                    "docsnest.dattrandev.id.vn/config-sha256": config_hash(
                                        name, {}
                                    )
                                }
                            },
                            "spec": {"containers": [{"image": image, "env": []}]},
                        },
                    },
                    "status": {
                        "readyReplicas": 1,
                        "availableReplicas": 1,
                        "updatedReplicas": 1,
                        "replicas": 1,
                        "observedGeneration": 1,
                    },
                }
                for name, image in self.images.items()
            },
        }

    def test_config_only_change_selects_consumers_and_proxy_change_selects_web(self):
        scope = configuration_scope(
            {"MAX_USERS": "20"}, {}, {"applications": []}, self.live, ""
        )
        self.assertEqual(scope, ["identity-service"])
        self.assertEqual(
            configuration_scope(
                {}, {}, {"applications": []}, self.live, "35.191.0.0/16"
            ),
            ["web"],
        )
        self.assertEqual(
            configuration_scope({}, {}, {"applications": []}, self.live, ""), []
        )

    def test_noop_and_google_client_rotation_use_real_git_impact(self):
        commit = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip()
        with patch.dict(
            os.environ, {"GITHUB_SHA": commit, "GOOGLE_CLIENT_ID": "client"}
        ):
            state = {"commit": commit, "googleClientId": "client"}
            self.assertEqual(plan(state)["images"], [])
            state["googleClientId"] = "old-client"
            self.assertEqual(plan(state)["images"], ["web"])
            self.assertEqual(plan(None)["images"], list(NAMES))

    def test_live_evidence_roundtrip_preserves_unrelated_pod_identity(self):
        self.live["pods"] = [
            {"metadata": {"uid": "old-pod", "labels": {"app": "identity-service"}}}
        ]
        before = json.loads(json.dumps(evidence_inventory(self.live)))
        verify_unrelated(before, evidence_inventory(self.live), [])
        self.live["pods"][0]["metadata"]["uid"] = "replaced-pod"
        with self.assertRaises(ValueError):
            verify_unrelated(
                before, evidence_inventory(self.live), ["document-service"]
            )

    def test_bootstrap_requires_all_same_run_scanned_images_and_preserves_old_digests(
        self,
    ):
        repository = "https://github.com/example/docnest"
        run = repository + "/actions/runs/100"
        images = {
            name: image.replace("a" * 64, "b" * 64)
            for name, image in self.images.items()
        }
        build = {
            "schemaVersion": 2,
            "nativeFormatVersion": 6,
            "environment": "cloud-gke",
            "ref": "refs/heads/main",
            "commit": "c" * 40,
            "runUrl": run,
            "googleClientId": "",
            "images": images,
            "imageProvenance": {
                name: {
                    "image": image,
                    "commit": "c" * 40,
                    "runUrl": run,
                    "scan": {
                        "highCriticalGate": "PASS",
                        "secretGate": "PASS",
                        "evidenceSha256": "d" * 64,
                        "imageId": "sha256:" + "e" * 64,
                    },
                }
                for name, image in images.items()
            },
        }
        original = Path.cwd()
        with tempfile.TemporaryDirectory() as temporary:
            os.chdir(temporary)
            try:
                Path("deployment-evidence").mkdir()
                environment = {
                    "PROJECT": "example-lab",
                    "REGION": "asia-southeast1",
                    "GITHUB_SHA": "c" * 40,
                    "REPOSITORY_URL": repository,
                    "RUN_URL": run,
                    "BUILD_MANIFEST": json.dumps(build),
                    "GOOGLE_CLIENT_ID": "",
                }
                with (
                    patch.dict(os.environ, environment),
                    patch("routine_release.inventory", return_value=self.live),
                ):
                    prepare(None, {"images": list(NAMES)})
                    state = json.loads(
                        Path("deployment-evidence/environment-state.json").read_text()
                    )
                    self.assertEqual(state["previousImages"], self.images)
                    self.assertEqual(state["images"], images)
                    self.assertEqual(state["rolloutStatus"], "PENDING")
                    self.assertFalse(state["mutationStarted"])
                    with self.assertRaises(ValueError):
                        prepare(None, {"images": ["document-service"]})
            finally:
                os.chdir(original)

    def test_migrations_are_hash_reviewed_and_schema_copies_match(self):
        validate_policy()
        validate_compatibility({"coordinated": False})
        with self.assertRaises(ValueError):
            validate_compatibility({"coordinated": True})
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = (
                root
                / "backend/document-service/src/main/resources/db/migration/V1__expand.sql"
            )
            mirror = root / "backend/schema/document/V1__expand.sql"
            for item in (path, mirror):
                item.parent.mkdir(parents=True, exist_ok=True)
                item.write_text("CREATE TABLE example(id INT);\n")
            policy = root / "infra/k8s/rolling-migrations.json"
            policy.parent.mkdir(parents=True)
            policy.write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "reviewedExpandMigrations": {
                            path.relative_to(root).as_posix(): migration_hash(path)
                        },
                    }
                )
            )
            validate_policy(root)
            path.write_text("DROP TABLE example;\n")
            mirror.write_text(path.read_text())
            with self.assertRaises(ValueError):
                validate_policy(root)

    def test_one_release_button_and_internal_scanned_builder(self):
        workflows = {
            p.name: yaml.load(p.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)
            for p in (ROOT / ".github/workflows").glob("*.yml")
        }
        self.assertEqual(
            set(workflows), {"ci.yml", "cloud-images.yml", "gke-build-deploy.yml"}
        )
        release = workflows["gke-build-deploy.yml"]
        self.assertEqual(set(release["on"]), {"workflow_dispatch"})
        self.assertFalse(release["on"]["workflow_dispatch"])
        self.assertEqual(
            release["concurrency"],
            {"group": "cloud-gke-deployment", "cancel-in-progress": "false"},
        )
        builder = workflows["cloud-images.yml"]
        self.assertEqual(set(builder["on"]), {"workflow_call"})
        self.assertEqual(builder["jobs"]["images"]["environment"], "cloud-gke")
        self.assertEqual(builder["jobs"]["validate"]["with"]["runtime_checks"], "true")
        for workflow in workflows.values():
            self.assertNotIn("GCP_BACKUP_SERVICE_ACCOUNT", json.dumps(workflow))
        rules = next(
            yaml.safe_load_all(
                (ROOT / "infra/k8s/deploy-rbac.example.yaml").read_text()
            )
        )["rules"]
        self.assertFalse(
            any(
                "secrets" in rule["resources"] or "pods/exec" in rule["resources"]
                for rule in rules
            )
        )
        script = (ROOT / "tooling/scripts/setup_gke_actions.sh").read_text()
        self.assertNotIn("gcloud storage buckets create", script)
        self.assertNotIn("setup_gke_backup.sh", script)


if __name__ == "__main__":
    unittest.main()
