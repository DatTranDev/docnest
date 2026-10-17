"""Failure-path/unit and real HTTP transport checks, separate from GKE/SQL acceptance."""

import copy
import datetime as dt
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
import threading
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tooling/scripts"))
from ci_timings import durations
from deployment_state import reconciled
from digest_manifest import NAMES
from drain_policy import policy, validate_backend, validate_web
from release_recovery import approve, fingerprint, make_plan
from rollout_traffic import Client, Measurements, ProbeFailure, native_fixture
from routine_release import ACCEPTANCE_PROFILE, validation_required
from capacity_report import quantity, report as capacity_report
from cloud_backup import DBS, load_manifest

sys.path.insert(0, str(ROOT / "testing/checks"))
from mixed_migration_gate import owners as migration_owners
from mixed_version_check import run as isolated_command
from archive_release import evidence_sources
from pitr_chain_check import PitrChainTests
from runtime_diagnostics import gateway_events, states as runtime_states


class DrainTests(unittest.TestCase):
    def test_capacity_bound_rejects_insufficient_cpu_and_unknown_quantities(self):
        self.assertEqual(quantity("100m"), quantity("0.1"))
        self.assertEqual(quantity("1Gi"), quantity("1024Mi"))
        with self.assertRaises(ValueError):
            quantity("unavailable")
        nodes = {
            "items": [
                {
                    "spec": {},
                    "status": {
                        "allocatable": {"cpu": "1", "memory": "1Gi"},
                        "conditions": [{"type": "Ready", "status": "True"}],
                    },
                }
            ]
        }
        pods = {"items": []}
        applications = [
            {
                "spec": {
                    "replicas": 2,
                    "template": {
                        "spec": {
                            "containers": [
                                {
                                    "resources": {
                                        "requests": {"cpu": "300m", "memory": "64Mi"}
                                    }
                                }
                            ]
                        }
                    },
                }
            }
        ]
        value = capacity_report(nodes, pods, applications)
        self.assertEqual(
            value["capacityStatus"], "INSUFFICIENT_CONSERVATIVE_REQUEST_BOUND"
        )
        self.assertFalse(value["criticalReplicasCanUseDistinctNodes"])

    def test_budget_matches_real_rendered_web_and_ingress(self):
        value = policy()
        objects = list(
            yaml.safe_load_all(
                (ROOT / "infra/k8s/base/web.yaml").read_text(encoding="utf-8")
            )
        )
        validate_web(next(obj for obj in objects if obj["kind"] == "Deployment"))
        backend = next(
            yaml.safe_load_all(
                (ROOT / "infra/k8s/ingress.example.yaml").read_text(encoding="utf-8")
            )
        )
        validate_backend(backend)
        self.assertGreaterEqual(
            value["webTerminationGraceSeconds"], value["webPreStopSeconds"] + 135
        )
        backend["spec"]["connectionDraining"]["drainingTimeoutSec"] = 30
        with self.assertRaisesRegex(ValueError, "reconcile"):
            validate_backend(backend)


def recovery_fixture():
    images = {name: "registry/" + name + "@sha256:" + "a" * 64 for name in NAMES}
    baseline = {"images": images, "rolloutStatus": "PASS"}
    failed = {
        "images": {
            **images,
            "document-service": "registry/document-service@sha256:" + "b" * 64,
        },
        "previousImages": images,
        "runUrl": "https://github.com/example/repo/actions/runs/1",
        "previousConfigSha256": "d" * 64,
        "desiredConfigSha256": "e" * 64,
    }
    before, live = {"deployments": {}}, {}
    for name in NAMES:
        template = {
            "metadata": {"labels": {"app": name}},
            "spec": {"containers": [{"name": name, "image": images[name]}]},
        }
        before["deployments"][name] = {
            "uid": name + "-uid",
            "replicas": 1,
            "templateSha256": hashlib.sha256(
                json.dumps(template, sort_keys=True).encode()
            ).hexdigest(),
        }
        live[name] = {
            "metadata": {"uid": name + "-uid", "resourceVersion": "10"},
            "spec": {"replicas": 1, "template": copy.deepcopy(template)},
        }
    live["document-service"]["spec"]["template"]["spec"]["containers"][0]["image"] = (
        failed["images"]["document-service"]
    )
    compatibility = {
        "status": "PASS",
        "oldImages": images,
        "newImages": failed["images"],
        "schemaCompatible": True,
        "eventsCompatible": True,
        "nativeFormatVersion": 6,
        "flywayHistorySha256": {
            owner: "c" * 64
            for owner in (
                "identity",
                "document",
                "processing",
                "collaboration",
                "payment",
            )
        },
    }
    return failed, baseline, before, live, compatibility


class RecoveryTests(unittest.TestCase):
    def test_runtime_diagnostics_discard_payloads_and_unknown_fields(self):
        secret = "private-fixture-must-not-escape"
        result = runtime_states(
            [
                {
                    "Config": {
                        "Labels": {"com.docker.compose.service": "document-service"},
                        "Env": [secret],
                    },
                    "State": {
                        "Running": True,
                        "OOMKilled": False,
                        "ExitCode": 0,
                        "Error": secret,
                        "Health": {"Status": "healthy", "Log": [secret]},
                    },
                    "RestartCount": 2,
                },
                {"Config": {"Labels": {"com.docker.compose.service": secret}}},
            ]
        )
        events = gateway_events(
            json.dumps(
                {
                    "event": "UPSTREAM_FAILURE",
                    "code": "ECONNRESET",
                    "reusedSocket": True,
                    "message": secret,
                }
            )
            + "\n"
            + json.dumps({"event": "UPSTREAM_FAILURE", "code": secret, "retry": secret})
        )
        self.assertEqual(result[0]["restarts"], 2)
        self.assertEqual(events[0]["code"], "ECONNRESET")
        self.assertEqual(events[1]["code"], "OTHER")
        self.assertNotIn(secret, json.dumps([result, events]))

    def test_evidence_retention_covers_reused_images_and_acceptance(self):
        repository = "https://github.com/example/docnest"
        images = {name: "image-" + name for name in NAMES}
        state = {
            "images": images,
            "imageProvenance": {
                name: {
                    "image": image,
                    "commit": "a" * 40,
                    "runUrl": repository + "/actions/runs/1",
                    "scan": {
                        "highCriticalGate": "PASS",
                        "secretGate": "PASS",
                        "evidenceSha256": "b" * 64,
                        "imageId": "sha256:" + "c" * 64,
                    },
                }
                for name, image in images.items()
            },
            "acceptanceGate": {"runUrl": repository + "/actions/runs/2"},
        }
        sources = evidence_sources(state, repository, "3")
        self.assertEqual(sources["3"], {"deployment-evidence"})
        self.assertEqual(
            sources["1"], {"cloud-image-digests", "cloud-image-scan-evidence"}
        )
        self.assertEqual(sources["2"], {"application-acceptance-evidence"})
        self.assertEqual(
            evidence_sources(state, repository, "1")["1"],
            {"deployment-evidence", "cloud-image-digests", "cloud-image-scan-evidence"},
        )
        state["acceptanceGate"][
            "runUrl"
        ] = "https://github.com/foreign/repo/actions/runs/2"
        with self.assertRaises(ValueError):
            evidence_sources(state, repository, "3")

    def test_isolated_profile_overrides_inherited_provider_credentials(self):
        import os

        with tempfile.TemporaryDirectory() as temporary:
            config = Path(temporary) / ".env"
            config.write_text(
                "STRIPE_SECRET_KEY=\nSTORAGE_PROVIDER=LOCAL\n", encoding="utf-8"
            )
            output = isolated_command(
                [
                    sys.executable,
                    "-c",
                    "import os; print(os.environ['STRIPE_SECRET_KEY'] == '' and os.environ['STORAGE_PROVIDER'] == 'LOCAL')",
                    "--env-file",
                    str(config),
                ],
                environment={
                    **os.environ,
                    "STRIPE_SECRET_KEY": "synthetic-parent-key",
                    "STORAGE_PROVIDER": "GCS",
                },
            )
            self.assertEqual(output.strip(), "True")

    def test_migration_gate_cannot_skip_an_unbuilt_owner(self):
        self.assertEqual(migration_owners({"impact": {"migrations": []}}, ["web"]), [])
        self.assertEqual(
            migration_owners(
                {"impact": {"migrations": ["document-service"]}}, ["document-service"]
            ),
            ["document-service"],
        )
        with self.assertRaises(ValueError):
            migration_owners({"impact": {"migrations": ["document-service"]}}, ["web"])
        with self.assertRaises(ValueError):
            migration_owners({"impact": {"migrations": ["web"]}}, ["web"])

    def test_current_state_reconciliation_requires_every_normalized_template(self):
        failed, baseline, before, live, compatibility = recovery_fixture()
        with self.assertRaises(ValueError):
            make_plan(
                "test-context",
                failed,
                baseline,
                before,
                live,
                compatibility,
                target="current",
            )
        failed["desiredTemplateSha256"] = {
            name: hashlib.sha256(
                json.dumps(obj["spec"]["template"], sort_keys=True).encode()
            ).hexdigest()
            for name, obj in live.items()
        }
        plan = make_plan(
            "test-context",
            failed,
            baseline,
            before,
            live,
            compatibility,
            target="current",
        )
        self.assertEqual(plan["action"], "reconcile-current")
        self.assertEqual(plan["selectedServices"], [])
        live["web"]["spec"]["template"]["metadata"]["annotations"] = {
            "drift": "changed"
        }
        with self.assertRaises(ValueError):
            make_plan(
                "test-context",
                failed,
                baseline,
                before,
                live,
                compatibility,
                target="current",
            )

    def test_online_object_restore_is_opt_in_and_checks_original_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            (folder / "databases.sql").write_bytes(b"integrity fixture only")
            (folder / "identity-key.pem").write_bytes(b"key integrity fixture only")
            manifest = {
                "format": 2,
                "kind": "online-snapshot",
                "quiesced": False,
                "databases": list(DBS),
                "binlogBoundary": {"file": "binlog.000001", "position": 4},
                "objects": [],
                "records": [],
                "sqlSha256": hashlib.sha256(
                    (folder / "databases.sql").read_bytes()
                ).hexdigest(),
                "keySha256": hashlib.sha256(
                    (folder / "identity-key.pem").read_bytes()
                ).hexdigest(),
            }
            (folder / "manifest.json").write_text(
                json.dumps(manifest), encoding="utf-8"
            )
            with self.assertRaises(ValueError):
                load_manifest(folder)
            self.assertEqual(load_manifest(folder, allow_online=True)[1], manifest)
            (folder / "identity-key.pem").write_bytes(b"tampered")
            with self.assertRaises(ValueError):
                load_manifest(folder, allow_online=True)

    def test_noop_reuses_only_recent_same_commit_complete_acceptance(self):
        now = dt.datetime.now(dt.timezone.utc)
        state = {
            "acceptanceGate": {
                "profile": ACCEPTANCE_PROFILE,
                "commit": "a" * 40,
                "runUrl": "https://github.com/example/repo/actions/runs/1",
                "completedAt": (now - dt.timedelta(hours=1)).isoformat(),
            }
        }
        self.assertFalse(validation_required(state, "a" * 40, now))
        self.assertTrue(validation_required(state, "b" * 40, now))
        self.assertTrue(
            validation_required(state, "a" * 40, now + dt.timedelta(days=2))
        )
        self.assertTrue(validation_required(None, "a" * 40, now))
        state["acceptanceGate"]["profile"] = "basic"
        self.assertTrue(validation_required(state, "a" * 40, now))

    def test_only_changed_image_is_planned_and_explicit_approval_expires(self):
        plan = make_plan("test-context", *recovery_fixture())
        self.assertEqual(plan["selectedServices"], ["document-service"])
        self.assertFalse(plan["approved"])
        with self.assertRaises(ValueError):
            approve(plan, plan)
        reviewed = {**plan, "approved": True}
        approve(reviewed, plan)
        reviewed["expiresAt"] = (
            dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=1)
        ).isoformat()
        with self.assertRaises(ValueError):
            approve(reviewed, plan)

    def test_changed_config_replica_uid_or_unproven_events_block_rollback(self):
        for mutation in ("config", "replica", "uid", "events", "schema"):
            failed, baseline, before, live, compatibility = recovery_fixture()
            if mutation == "config":
                live["document-service"]["spec"]["template"]["metadata"][
                    "annotations"
                ] = {"config": "changed"}
            elif mutation == "replica":
                live["document-service"]["spec"]["replicas"] = 2
            elif mutation == "uid":
                live["document-service"]["metadata"]["uid"] = "recreated"
            else:
                compatibility[mutation + "Compatible"] = False
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                make_plan("test-context", failed, baseline, before, live, compatibility)

    def test_protected_reconciliation_binds_exact_failed_state_and_previous_images(
        self,
    ):
        failed, baseline, *_ = recovery_fixture()
        recovered = {
            **baseline,
            "recoveryOf": {
                "failedStateSha256": fingerprint(failed),
                "runUrl": failed["runUrl"],
                "decision": "operator-approved-image-rollback",
                "trafficSha256": "a" * 64,
                "compatibilitySha256": "b" * 64,
                "configurationSha256": "d" * 64,
            },
        }
        self.assertEqual(reconciled(failed, recovered), recovered)
        for field in ("runUrl", "failedStateSha256", "trafficSha256"):
            broken = copy.deepcopy(recovered)
            broken["recoveryOf"][field] = "different"
            with self.subTest(field=field), self.assertRaises(ValueError):
                reconciled(failed, broken)


class TransportTests(unittest.TestCase):
    def test_actual_http_errors_are_counted_without_retaining_private_payload(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(503)
                self.end_headers()
                self.wfile.write(b"private fixture payload")

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        try:
            measurements = Measurements()
            client = Client(f"http://127.0.0.1:{server.server_port}", measurements)
            with self.assertRaises(ProbeFailure):
                client.request("read", "GET", "/synthetic")
            report = measurements.report()
            self.assertEqual(report["http5xx"], 1)
            self.assertEqual(report["failedRequests"], 1)
            self.assertNotIn("private fixture payload", json.dumps(report))
            with self.assertRaises(ProbeFailure):
                client.request("upload", "PUT", "https://untrusted.invalid/capability")
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_native_fixture_changes_without_losing_canonical_format(self):
        import io
        import zipfile

        first, second = native_fixture(0), native_fixture(1)
        self.assertEqual(first, native_fixture(0))
        self.assertNotEqual(first, second)
        with zipfile.ZipFile(io.BytesIO(second)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            self.assertEqual(
                manifest["textSha256"],
                hashlib.sha256(archive.read("text.utf8")).hexdigest(),
            )

    def test_timing_report_does_not_count_running_jobs_or_sum_parallel_work(self):
        rows = durations(
            [
                {
                    "name": "finished",
                    "status": "completed",
                    "started_at": "2026-10-17T01:00:00Z",
                    "completed_at": "2026-10-17T01:00:07Z",
                    "steps": [],
                },
                {"name": "running", "status": "in_progress"},
            ]
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["seconds"], 7)


if __name__ == "__main__":
    result = unittest.main(exit=False).result
    report = ROOT / "testing/reports/release-resilience.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(
        json.dumps(
            {
                "status": "PASS" if result.wasSuccessful() else "FAIL",
                "testsRun": result.testsRun,
                "failures": len(result.failures),
                "errors": len(result.errors),
                "scope": "Unit/policy and actual local HTTP transport; separate SQL/GKE acceptance required",
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    raise SystemExit(0 if result.wasSuccessful() else 1)
