"""Offline recovery-transform/property checks; no mocked or real Google Cloud pass."""

import copy
import hashlib
import importlib.util
import json
import pathlib
import random
import tempfile
import unittest
from jsonschema import Draft202012Validator, FormatChecker

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "cloud_backup", ROOT / "scripts/cloud_backup.py"
)
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)
OLD = {
    "provider": "GCS",
    "bucket": "original-private-snapshots",
    "key": "snapshots/a/b.tedoc",
    "generation": "12345",
}
NEW = dict(OLD, bucket="isolated-private-snapshots", generation="67890")


def catalog():
    return {
        "objects": [{"ref": OLD}],
        "records": [
            {
                "database": "document_db",
                "table": "document_versions",
                "primary": {"id": "version"},
                "column": "scalar",
                "value": OLD,
                "required": True,
            },
            {
                "database": "document_db",
                "table": "upload_sessions",
                "primary": {"id": "upload"},
                "column": "scalar",
                "value": OLD,
                "required": False,
            },
            {
                "database": "processing_db",
                "table": "jobs",
                "primary": {"id": "job"},
                "column": "source_ref",
                "value": OLD,
                "required": True,
            },
        ],
    }


def mapping():
    return {"objects": [{"original": OLD, "restored": NEW}]}


class RecoveryCheck(unittest.TestCase):
    def test_actual_event_envelopes_keep_schema_and_all_nonref_fields(self):
        count = 0
        for topic, field in [
            ("document.version.saved.v1", "objectRef"),
            ("processing.job.completed.v1", "outputRef"),
        ]:
            event = json.loads(
                (ROOT / f"contracts/events/{topic}.example.json").read_text()
            )
            event["payload"][field] = copy.deepcopy(OLD)
            rewritten = backup.rewrite_refs(event, {backup.ref_identity(OLD): NEW})
            self.assertEqual(rewritten["eventId"], event["eventId"])
            expected = copy.deepcopy(event)
            expected["payload"][field] = NEW
            self.assertEqual(rewritten, expected)
            schema = json.loads(
                (ROOT / f"contracts/events/{topic}.schema.json").read_text()
            )
            Draft202012Validator(schema, format_checker=FormatChecker()).validate(
                rewritten
            )
            self.assertEqual(event["payload"][field], OLD)
            count += 1
        self.assertEqual(count, 2)

    def test_500_seeded_nested_cases_match_exact_generation_only(self):
        rng = random.Random(9917)
        for _ in range(500):
            other = dict(OLD, generation=str(rng.randrange(100000, 999999)))
            data = {
                "summary": {"sampleText": "Việt Nam 👨‍👩‍👧‍👦 <>&"},
                "refs": [OLD, None, other],
                "eventId": str(rng.getrandbits(128)),
            }
            rewritten = backup.rewrite_refs(data, {backup.ref_identity(OLD): NEW})
            self.assertEqual(rewritten["refs"], [NEW, None, other])
            self.assertEqual(rewritten["summary"], data["summary"])
            self.assertEqual(rewritten["eventId"], data["eventId"])
            self.assertEqual(
                backup.rewrite_refs(rewritten, {backup.ref_identity(OLD): NEW}),
                rewritten,
            )

    def test_sql_catalog_is_database_specific_guarded_and_capabilities_invalidated(
        self,
    ):
        patch = backup.reference_patch(catalog(), mapping())
        self.assertEqual(set(patch), set(backup.DBS))
        self.assertIn("USE document_db;", patch["document_db"])
        self.assertIn(
            "UPDATE document_versions SET storage_bucket=", patch["document_db"]
        )
        self.assertIn("AND object_generation=", patch["document_db"])
        self.assertNotIn("processing_db", patch["document_db"])
        self.assertNotIn("document_db", patch["processing_db"])
        self.assertIn("source_ref=CAST(", patch["processing_db"])
        self.assertIn("resumable_uri=NULL", patch["document_db"])
        self.assertIn(
            "state=IF(state='COMMITTED','COMMITTED','ABANDONED')", patch["document_db"]
        )
        self.assertNotIn("UPDATE", patch["identity_db"])

    def test_incomplete_mapping_and_changed_key_or_live_bucket_rejected(self):
        for invalid in [
            {"objects": []},
            {
                "objects": [
                    {
                        "original": OLD,
                        "restored": dict(NEW, key="snapshots/other/file.tedoc"),
                    }
                ]
            },
            {
                "objects": [
                    {"original": OLD, "restored": dict(NEW, bucket=OLD["bucket"])}
                ]
            },
        ]:
            with self.assertRaises(ValueError):
                backup.reference_patch(catalog(), invalid)

    def test_catalog_identifier_and_primary_key_injection_rejected(self):
        for key, invalid in [
            ("database", "mysql"),
            ("table", "users"),
            ("column", "password_hash"),
            ("primary", {"id;DROP TABLE jobs": "x"}),
        ]:
            data = catalog()
            data["records"][0][key] = invalid
            with self.assertRaises(ValueError):
                backup.reference_patch(data, mapping())
        literal = backup.sql_text("x'; SELECT SECRET; --\nđ")
        self.assertNotIn("SECRET", literal)
        self.assertEqual(
            bytes.fromhex(literal.split("0x")[1].split(" ")[0]).decode("utf-8"),
            "x'; SELECT SECRET; --\nđ",
        )

    def test_historical_reference_remains_exact_but_missing_required_is_rejected(self):
        data = catalog()
        historical = dict(OLD, generation="111")
        data["records"].append(
            {
                "database": "processing_db",
                "table": "jobs",
                "primary": {"id": "historical"},
                "column": "source_ref",
                "value": historical,
                "required": False,
            }
        )
        patch = backup.reference_patch(data, mapping())
        self.assertNotIn(backup.sql_text("historical"), patch["processing_db"])
        data["records"][-1]["required"] = True
        with self.assertRaises(ValueError):
            backup.reference_patch(data, mapping())

    def test_ref_path_generation_unknown_fields_and_non_gcs_rejected(self):
        for ref in [
            dict(OLD, key="snapshots/../outside"),
            dict(OLD, key="snapshots/a#2"),
            dict(OLD, key="snapshots/a\nprivate"),
            dict(OLD, generation="null"),
            dict(OLD, secret="private"),
            dict(OLD, provider="LOCAL"),
        ]:
            with self.assertRaises(ValueError):
                backup.ref_identity(ref)

    def test_real_archive_files_hashes_and_traversal_rejection(self):
        with tempfile.TemporaryDirectory() as task:
            folder = pathlib.Path(task)
            (folder / "objects").mkdir()
            (folder / "databases.sql").write_bytes(b"CREATE DATABASE identity_db;")
            (folder / "identity-key.pem").write_bytes(b"fixture-not-a-real-private-key")
            native = (ROOT / "fixtures/native/empty.tedoc").read_bytes()
            name = "a" * 64 + ".bin"
            (folder / "objects" / name).write_bytes(native)
            manifest = {
                "format": 1,
                "quiesced": True,
                "sqlSha256": backup.fingerprint(folder / "databases.sql"),
                "keySha256": backup.fingerprint(folder / "identity-key.pem"),
                "objects": [
                    {
                        "ref": OLD,
                        "file": name,
                        "bytes": len(native),
                        "sha256": hashlib.sha256(native).hexdigest(),
                    }
                ],
            }
            backup.protected_json(folder / "manifest.json", manifest)
            backup.load_manifest(folder)
            (folder / "objects" / name).write_bytes(native + b"x")
            with self.assertRaises(ValueError):
                backup.load_manifest(folder)
            manifest["objects"][0]["file"] = "../identity-key.pem"
            backup.protected_json(folder / "manifest.json", manifest)
            with self.assertRaises(ValueError):
                backup.load_manifest(folder)


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(RecoveryCheck)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    report = {
        "status": "PASS" if result.wasSuccessful() else "FAIL",
        "tests": result.testsRun,
        "scope": "offline real fixture/archive/hash/reference-transform tests; 500 seeded nested cases; no cloud API or SQL restore executed",
        "cloudBackupRestore": "NOT_RUN",
    }
    (ROOT / "reports/cloud-backup-local.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
    raise SystemExit(0 if result.wasSuccessful() else 1)
