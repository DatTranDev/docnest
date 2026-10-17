"""Validate the backup approval trust boundary and private database discovery."""

import copy
import datetime as dt
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tooling/scripts"))
from backup_runtime import (
    latest_release,
    mysql_endpoint,
    prepared_config,
    validate_release,
)
from digest_manifest import NAMES


class BackupRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.config = {
            "project": "sample-project",
            "region": "asia-southeast1",
            "repository": "https://github.com/example/editor",
        }
        self.value = {
            "format": 1,
            "repository": self.config["repository"],
            "commit": "a" * 40,
            "runUrl": self.config["repository"] + "/actions/runs/100",
            "runAttempt": 2,
            "images": {
                name: "asia-southeast1-docker.pkg.dev/sample-project/editor/"
                + name
                + "@sha256:"
                + "b" * 64
                for name in NAMES
            },
        }
        self.name = "approved-releases/100-2.json"
        self.row = {
            "type": "cloud_object",
            "metadata": {
                "bucket": "sample-recovery",
                "name": self.name,
                "generation": "1000",
                "timeCreated": "2026-01-01T00:00:00Z",
            },
        }
        self.endpoint = {
            "subsets": [
                {
                    "addresses": [{"ip": "10.42.0.5"}],
                    "ports": [{"port": 3306, "protocol": "TCP"}],
                }
            ]
        }

    def test_complete_bound_approval_accepts_only_six_project_digests(self):
        self.assertEqual(
            validate_release(self.value, self.config, self.name), self.value["images"]
        )
        invalid = [
            dict(self.value, repository="https://github.com/other/editor"),
            dict(self.value, runAttempt=1),
            dict(self.value, runAttempt=True),
            dict(self.value, format=True),
            dict(self.value, commit="main"),
            dict(self.value, extra="unexpected"),
            dict(self.value, images={"web": self.value["images"]["web"]}),
        ]
        foreign = copy.deepcopy(self.value)
        foreign["images"]["web"] = foreign["images"]["web"].replace(
            "sample-project/", "foreign-project/"
        )
        invalid.append(foreign)
        for value in invalid:
            with self.subTest(value=list(value)), self.assertRaises(ValueError):
                validate_release(value, self.config, self.name)
        for name in (
            "recovery/100-2.json",
            "approved-releases/../100-2.json",
            "approved-releases/101-2.json",
        ):
            with self.subTest(name=name), self.assertRaises(ValueError):
                validate_release(self.value, self.config, name)

    def test_latest_uses_storage_creation_time_instead_of_run_id_or_list_order(self):
        later = copy.deepcopy(self.row)
        later["metadata"].update(
            name="approved-releases/99-1.json",
            timeCreated="2026-02-01T00:00:00Z",
            generation="999",
        )
        for rows in ([self.row, later], [later, self.row]):
            self.assertEqual(
                latest_release(rows, "sample-recovery")["name"],
                later["metadata"]["name"],
            )

    def test_foreign_bucket_paths_generations_and_timestamps_fail_closed(self):
        for field, value in (
            ("bucket", "other-recovery"),
            ("name", "recovery/100-2.json"),
            ("name", "approved-releases/*-2.json"),
            ("generation", "1?alt=media"),
            ("timeCreated", "2026-01-01T00:00:00"),
            (
                "timeCreated",
                (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1)).isoformat(),
            ),
        ):
            row = copy.deepcopy(self.row)
            row["metadata"][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                latest_release([row], "sample-recovery")
        with self.assertRaises(ValueError):
            latest_release([], "sample-recovery")

    def test_endpoint_requires_one_ready_private_ipv4_on_mysql_tcp(self):
        self.assertEqual(mysql_endpoint(self.endpoint), "10.42.0.5")
        for address in ("8.8.8.8", "127.0.0.1", "169.254.169.254", "0.0.0.0", "::1"):
            value = copy.deepcopy(self.endpoint)
            value["subsets"][0]["addresses"][0]["ip"] = address
            with self.subTest(address=address), self.assertRaises(ValueError):
                mysql_endpoint(value)
        for change in (
            {"addresses": []},
            {"notReadyAddresses": [{"ip": "10.42.0.6"}]},
            {"ports": [{"port": 3306, "protocol": "UDP"}]},
            {"addresses": [{"ip": "10.42.0.5"}, {"ip": "10.42.0.6"}]},
        ):
            value = copy.deepcopy(self.endpoint)
            value["subsets"][0].update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                mysql_endpoint(value)

    def test_static_legacy_configuration_is_preserved_and_private_inputs_are_removed(
        self,
    ):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "tmp").mkdir()
            config = {
                **self.config,
                "outputDirectory": str(root),
                "images": "/static/approved.json",
            }
            with prepared_config(config, snapshot=True) as prepared:
                self.assertEqual(prepared, config)
                self.assertEqual(len(list((root / "tmp").iterdir())), 1)
            self.assertEqual(list((root / "tmp").iterdir()), [])


if __name__ == "__main__":
    unittest.main()
