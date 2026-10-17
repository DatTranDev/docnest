"""Fail-closed policy cases; actual GitHub/GKE/SQL execution remains separate."""

import copy
import hashlib
import io
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tooling/scripts"))
from deployment_state import reconciled
from digest_manifest import NAMES
from release_recovery import approve, fingerprint
from routine_release import evidence_inventory
from unmodified_recovery import DECISION, MIGRATION_ARGS, make_plan, stage_jobs
from unmodified_recovery_evidence import (
    OWNERS,
    OperatorPodSchemaSource,
    artifact_files,
    expected_schema,
    history_query,
)


def fixture():
    images = {
        name: "asia-southeast1-docker.pkg.dev/sample-project/editor/"
        + name
        + "@sha256:"
        + "a" * 64
        for name in NAMES
    }
    baseline = {"images": images, "rolloutStatus": "PASS"}
    failed = {
        "images": {
            **images,
            "document-service": images["document-service"].replace("a" * 64, "b" * 64),
        },
        "previousImages": images,
        "rolloutStatus": "PENDING",
        "mutationStarted": True,
        "selectedServices": list(NAMES),
        "runUrl": "https://github.com/example/repo/actions/runs/1",
        "previousConfigSha256": "d" * 64,
        "desiredConfigSha256": "d" * 64,
        "imageProvenance": {
            "document-service": {"scan": {"imageId": "sha256:" + "c" * 64}}
        },
    }
    live = {"deployments": {}, "pods": []}
    for name in NAMES:
        live["deployments"][name] = {
            "metadata": {"uid": name + "-uid", "generation": 1},
            "spec": {
                "replicas": 1,
                "template": {
                    "metadata": {"labels": {"app": name}},
                    "spec": {"containers": [{"name": name, "image": images[name]}]},
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
        live["pods"].append(
            {"metadata": {"uid": name + "-pod", "labels": {"app": name}}}
        )
    job = "migrate-document-service-gh-1-1"
    names = [
        "validate-config",
        "validate-" + job,
        *("validate-" + name for name in NAMES),
        "apply-config",
        job,
        "wait-" + job,
    ]
    histories = {owner: "e" * 64 for owner in OWNERS}
    report = {
        "status": "PASS",
        "schemaCompatible": True,
        "nativeFormatVersion": 6,
        "eventsCompatible": False,
        "oldImages": {"document-service": images["document-service"]},
        "resolvedNewImages": {"document-service": "sha256:" + "c" * 64},
        "flywayHistorySha256": dict(histories),
    }
    bundle = {
        "runId": "1",
        "runAttempt": 1,
        "artifactIds": {"deployment-evidence": 1, "cloud-image-scan-evidence": 2},
        "deployment": {
            "before.json": evidence_inventory(live),
            "stages.json": [{"stage": name, "exitCode": 0} for name in names],
            "affected.json": {
                "migrations": ["document-service"],
                "applications": list(NAMES),
                "coordinated": False,
            },
        },
        "schemas": {
            "mixed-schema-document-service.json": report,
            "mixed-version-gate.json": {
                "status": "PASS",
                "owners": ["document-service"],
                "checks": [
                    {
                        "service": "document-service",
                        "reportSha256": "f" * 64,
                        "oldImage": images["document-service"],
                        "newImageId": "sha256:" + "c" * 64,
                    }
                ],
            },
        },
        "schemaFileHashes": {"mixed-schema-document-service.json": "f" * 64},
    }
    jobs = {
        job: {
            "metadata": {
                "uid": "migration-uid",
                "namespace": "editor-lab",
                "labels": {"application": "text-editor"},
            },
            "spec": {
                "template": {
                    "spec": {
                        "containers": [
                            {
                                "image": failed["images"]["document-service"],
                                "args": list(MIGRATION_ARGS),
                            }
                        ]
                    }
                }
            },
            "status": {
                "succeeded": 1,
                "conditions": [{"type": "Complete", "status": "True"}],
            },
        }
    }
    return failed, baseline, bundle, live, jobs, "d" * 64, histories


def plan(values):
    return make_plan("test-context", *values, "11111111-1111-4111-8111-111111111111")


class UnmodifiedRecoveryTests(unittest.TestCase):
    def test_only_exact_completed_migrate_only_job_pods_are_excluded(self):
        values = fixture()
        name, job = next(iter(values[4].items()))
        pod = {
            "metadata": {
                "uid": "migration-pod",
                "labels": {"app": "document-service"},
                "ownerReferences": [
                    {
                        "kind": "Job",
                        "controller": True,
                        "name": name,
                        "uid": job["metadata"]["uid"],
                    }
                ],
            },
            "spec": {
                "containers": copy.deepcopy(
                    job["spec"]["template"]["spec"]["containers"]
                )
            },
            "status": {"phase": "Succeeded"},
        }
        values[3]["pods"].append(pod)
        self.assertEqual(plan(values)["beforeSha256"], plan(values)["afterSha256"])
        for change in ("running", "owner", "unknown-job", "args", "image", "command"):
            invalid = copy.deepcopy(values)
            current = invalid[3]["pods"][-1]
            if change == "running":
                current["status"]["phase"] = "Running"
            elif change == "owner":
                current["metadata"]["ownerReferences"][0]["uid"] = "other-uid"
            elif change == "unknown-job":
                current["metadata"]["ownerReferences"][0]["name"] = "other-job"
            elif change == "args":
                current["spec"]["containers"][0]["args"] = []
            elif change == "image":
                current["spec"]["containers"][0]["image"] = "foreign"
            else:
                current["spec"]["containers"][0]["command"] = ["other"]
            with self.subTest(change=change), self.assertRaises(ValueError):
                plan(invalid)

    def test_schema_only_plan_never_approves_new_images_or_event_compatibility(self):
        values = fixture()
        result = plan(values)
        self.assertFalse(result["approved"])
        self.assertEqual(result["selectedServices"], [])
        self.assertEqual(result["targetImages"], values[1]["images"])
        self.assertEqual(result["beforeSha256"], result["afterSha256"])
        self.assertIn("NOT_ASSERTED", result["candidateEventCompatibility"])

    def test_every_application_identity_template_replica_and_ready_state_is_fenced(
        self,
    ):
        for change in (
            "image",
            "uid",
            "template",
            "replica",
            "pod",
            "unready",
            "deleting",
        ):
            values = fixture()
            live = values[3]
            obj = live["deployments"]["document-service"]
            if change == "image":
                obj["spec"]["template"]["spec"]["containers"][0]["image"] = values[0][
                    "images"
                ]["document-service"]
            elif change == "uid":
                obj["metadata"]["uid"] = "different"
            elif change == "template":
                obj["spec"]["template"]["metadata"]["annotations"] = {
                    "drift": "changed"
                }
            elif change == "replica":
                obj["spec"]["replicas"] = 2
            elif change == "pod":
                live["pods"][0]["metadata"]["uid"] = "replaced"
            elif change == "unready":
                obj["status"]["readyReplicas"] = 0
            else:
                live["pods"][0]["metadata"][
                    "deletionTimestamp"
                ] = "2026-01-01T00:00:00Z"
            with self.subTest(change=change), self.assertRaises(ValueError):
                plan(values)

    def test_configuration_or_actual_sql_history_drift_is_never_reconciled(self):
        for change in ("desired", "live-config", "history"):
            values = list(fixture())
            if change == "desired":
                values[0]["desiredConfigSha256"] = "a" * 64
            elif change == "live-config":
                values[5] = "a" * 64
            else:
                values[6]["document"] = "a" * 64
            with self.subTest(change=change), self.assertRaises(ValueError):
                plan(values)

    def test_application_apply_incomplete_failed_or_duplicate_stages_fail_closed(self):
        for change in ("apply", "incomplete", "failed", "duplicate", "protocol"):
            values = fixture()
            bundle = values[2]
            stages = bundle["deployment"]["stages.json"]
            if change == "apply":
                stages.append({"stage": "apply-document-service", "exitCode": 0})
            elif change == "incomplete":
                stages.pop()
            elif change == "failed":
                stages[-1]["exitCode"] = 1
            elif change == "duplicate":
                stages.insert(0, copy.deepcopy(stages[0]))
            else:
                bundle["deployment"]["affected.json"]["coordinated"] = True
            with self.subTest(change=change), self.assertRaises(ValueError):
                stage_jobs(bundle, values[0])

    def test_schema_proof_must_bind_exact_old_owner_scan_and_original_file_hash(self):
        for change in ("hash", "old", "scan", "native", "owner"):
            values = fixture()
            bundle = values[2]
            report = bundle["schemas"]["mixed-schema-document-service.json"]
            if change == "hash":
                bundle["schemaFileHashes"]["mixed-schema-document-service.json"] = (
                    "0" * 64
                )
            elif change == "old":
                report["oldImages"]["document-service"] = "foreign"
            elif change == "scan":
                report["resolvedNewImages"]["document-service"] = "sha256:" + "0" * 64
            elif change == "native":
                report["nativeFormatVersion"] = 5
            else:
                report["flywayHistorySha256"].pop("identity")
            with self.subTest(change=change), self.assertRaises(ValueError):
                expected_schema(bundle, values[0], values[1])

    def test_exact_successful_migration_job_and_reviewed_uid_are_required(self):
        for change in ("active", "failed", "incomplete", "image", "missing"):
            values = fixture()
            job = next(iter(values[4].values()))
            if change in ("active", "failed"):
                job["status"][change] = 1
            elif change == "incomplete":
                job["status"]["conditions"] = []
            elif change == "image":
                job["spec"]["template"]["spec"]["containers"][0]["image"] = "foreign"
            else:
                values[4].clear()
            with self.subTest(change=change), self.assertRaises(ValueError):
                plan(values)
        values = fixture()
        reviewed = {**plan(values), "approved": True}
        next(iter(values[4].values()))["metadata"]["uid"] = "recreated"
        with self.assertRaises(ValueError):
            approve(reviewed, plan(values))

    def test_protected_override_requires_identical_inventories_and_previous_image_target(
        self,
    ):
        values = fixture()
        failed, baseline = values[:2]
        result = plan(values)
        recovered = {
            **baseline,
            "selectedServices": [],
            "recoveryOf": {
                "decision": DECISION,
                "failedStateSha256": fingerprint(failed),
                "runUrl": failed["runUrl"],
                "configurationSha256": "d" * 64,
                "trafficSha256": "a" * 64,
                "compatibilitySha256": "b" * 64,
                "applicationMutationAbsent": True,
                "beforeSha256": result["beforeSha256"],
                "afterSha256": result["afterSha256"],
                "stagesSha256": result["stagesSha256"],
            },
        }
        self.assertEqual(reconciled(failed, recovered), recovered)
        for field, value in (
            ("afterSha256", "0" * 64),
            ("applicationMutationAbsent", False),
            ("stagesSha256", ""),
        ):
            invalid = copy.deepcopy(recovered)
            invalid["recoveryOf"][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                reconciled(failed, invalid)
        invalid = copy.deepcopy(recovered)
        invalid["images"] = failed["images"]
        with self.assertRaises(ValueError):
            reconciled(failed, invalid)

    def test_operator_schema_port_rejects_business_sql_and_export_or_execute_options(
        self,
    ):
        source = OperatorPodSchemaSource("test-context")
        with self.assertRaises(ValueError):
            source.query("SELECT * FROM identity_db.users;")
        with self.assertRaises(ValueError):
            source.command("mysqldump")
        with self.assertRaises(ValueError):
            source.command("mysql", ["--execute=DROP DATABASE document_db"])
        self.assertEqual(
            source.command("mysql", ["--batch"])[-1],
            'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --user=root --batch',
        )
        with self.assertRaises(ValueError):
            history_query("other")

    def test_archive_member_duplicates_missing_and_raw_file_hash_binding(self):
        def archive(entries):
            output = io.BytesIO()
            with zipfile.ZipFile(output, "w") as bundle:
                for name, data in entries:
                    bundle.writestr(name, data)
            return SimpleNamespace(request=lambda *args, **kwargs: output.getvalue())

        raw = b'{"status":"PASS"}\n'
        values, hashes = artifact_files(
            archive([("folder/proof.json", raw)]), {"id": 1}, {"proof.json"}
        )
        self.assertEqual(values["proof.json"]["status"], "PASS")
        self.assertEqual(hashes["proof.json"], hashlib.sha256(raw).hexdigest())
        for entries in (
            [],
            [("a/proof.json", raw), ("b/proof.json", raw)],
            [("proof.json", b" " * (1024**2 + 1))],
        ):
            with self.subTest(entries=len(entries)), self.assertRaises(ValueError):
                artifact_files(archive(entries), {"id": 1}, {"proof.json"})


if __name__ == "__main__":
    unittest.main()
