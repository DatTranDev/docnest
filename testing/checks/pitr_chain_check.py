"""Pure range/integrity planning checks; real binlog replay has a separate SQL drill."""

import copy
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tooling/scripts"))
from cloud_backup import fingerprint
from online_restore import replay_plan


class PitrChainTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.snapshot = {
            "source": {"serverUuid": "reviewed-server"},
            "binlogBoundary": {"file": "binlog.000010", "position": 20},
        }
        self.archives = []
        for index in (10, 11):
            directory = Path(self.temporary.name) / str(index)
            directory.mkdir()
            name = "binlog." + str(index).zfill(6)
            (directory / name).write_bytes(b"range-planner-fixture" * 4)
            self.archives.append(
                (
                    directory,
                    {
                        "kind": "closed-binlogs",
                        "serverUuid": "reviewed-server",
                        "logs": [
                            {
                                "file": name,
                                "sourceFile": name,
                                "startPosition": 4,
                                "sha256": fingerprint(directory / name),
                            }
                        ],
                        "nextBoundary": {
                            "file": "binlog." + str(index + 1).zfill(6),
                            "position": 4,
                        },
                    },
                )
            )

    def test_later_snapshot_uses_its_exact_offset_then_complete_consecutive_archives(
        self,
    ):
        plan = replay_plan(self.archives, self.snapshot)
        self.assertEqual(
            [(name, position) for _, name, position in plan],
            [("binlog.000010", 20), ("binlog.000011", 4)],
        )
        earlier = copy.deepcopy(self.archives)
        directory, manifest = earlier[0]
        name = "binlog.000009"
        (directory / name).write_bytes(b"older-range-planner-fixture" * 4)
        manifest["logs"].insert(
            0,
            {
                "file": name,
                "sourceFile": name,
                "startPosition": 4,
                "sha256": fingerprint(directory / name),
            },
        )
        self.assertEqual(replay_plan(earlier, self.snapshot), plan)

    def test_gaps_overlap_reordered_missing_source_and_partial_continuation_fail(self):
        invalid = [
            self.archives[::-1],
            [self.archives[0], self.archives[0]],
            self.archives[1:],
            [],
        ]
        for field, value in (
            ("serverUuid", "foreign-server"),
            ("kind", "online-snapshot"),
            ("nextBoundary", {"file": "binlog.000099", "position": 4}),
        ):
            archives = copy.deepcopy(self.archives)
            archives[1][1][field] = value
            invalid.append(archives)
        archives = copy.deepcopy(self.archives)
        archives[1][1]["logs"][0]["startPosition"] = 8
        invalid.append(archives)
        for archives in invalid:
            with self.subTest(archives=len(archives)), self.assertRaises(ValueError):
                replay_plan(archives, self.snapshot)

    def test_uncaptured_snapshot_position_and_out_of_file_ranges_fail(self):
        for position in (3, True, 1000):
            snapshot = copy.deepcopy(self.snapshot)
            snapshot["binlogBoundary"]["position"] = position
            with self.subTest(position=position), self.assertRaises(ValueError):
                replay_plan(self.archives, snapshot)
        archives = copy.deepcopy(self.archives)
        archives[0][1]["logs"][0]["startPosition"] = 21
        with self.assertRaises(ValueError):
            replay_plan(archives, self.snapshot)

    def test_every_hash_path_and_cursor_is_checked_before_replay(self):
        for field, value in (
            ("file", "../binlog.000011"),
            ("sourceFile", "other.000011"),
            ("sha256", "0" * 64),
            ("startPosition", True),
        ):
            archives = copy.deepcopy(self.archives)
            archives[1][1]["logs"][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                replay_plan(archives, self.snapshot)
        (self.archives[1][0] / "binlog.000011").write_bytes(b"tampered")
        with self.assertRaises(ValueError):
            replay_plan(self.archives, self.snapshot)


if __name__ == "__main__":
    unittest.main()
