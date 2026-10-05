"""Unit checks for evidence parsing/refusal; these are not application acceptance gates."""

import importlib.util
import json
import pathlib
import tempfile
import unittest

SOURCE = pathlib.Path(__file__).with_name("write_implementation_report.py")
SPEC = importlib.util.spec_from_file_location("implementation_report", SOURCE)
REPORT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REPORT)


class EvidenceParserTest(unittest.TestCase):
    def test_vitest_counts_follow_workspace_and_are_not_fixed(self):
        log = "> @ted/web@2.0.0 test\n Tests 7 passed (7)\n> @ted/editor-core@2.0.0 test\n Tests 13 passed (13)\n"
        self.assertEqual(
            REPORT.frontend_counts(log), {"@ted/web": 7, "@ted/editor-core": 13}
        )

    def test_vitest_rejects_partial_skipped_and_duplicate_runs(self):
        for log in (
            "> @ted/web@1 test\nTests 2 passed (3)\n",
            "> @ted/web@1 test\nTests 2 passed (2)\n",
            "> @ted/web@1 test\nTests 2 passed (2)\nTests 2 passed (2)\n",
        ):
            with self.subTest(log=log), self.assertRaises(ValueError):
                REPORT.frontend_counts(log)

    def test_node_tap_and_unicode_reporters_are_combined(self):
        def summary(prefix, count):
            return "\n".join(
                f"{prefix} {key} {value}"
                for key, value in (
                    ("tests", count),
                    ("pass", count),
                    ("fail", 0),
                    ("cancelled", 0),
                    ("skipped", 0),
                    ("todo", 0),
                )
            )

        self.assertEqual(
            REPORT.node_counts(summary("#", 2) + "\n" + summary("ℹ", 8))["total"], 10
        )

    def test_node_rejects_skip_cancel_fail_todo_and_incomplete_summary(self):
        for field in ("fail", "cancelled", "skipped", "todo"):
            lines = [
                f"# {key} {1 if key == field else (2 if key in {'tests', 'pass'} else 0)}"
                for key in ("tests", "pass", "fail", "cancelled", "skipped", "todo")
            ]
            with self.subTest(field=field), self.assertRaises(ValueError):
                REPORT.node_counts("\n".join(lines))
        with self.assertRaises(ValueError):
            REPORT.node_counts("# tests 2\n# pass 2\n")

    def test_hash_guard_checks_current_source_and_same_run(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            source = root / "measured.ts"
            source.write_text("export const version = 1;", encoding="utf-8")
            hashes = {"measured.ts": REPORT.sha256(source)}
            evidence = {
                "sourceHashes": hashes,
                "sourceHashesAfter": dict(hashes),
                "sourcesUnchangedDuringRun": True,
            }
            REPORT.current_sources(root, evidence, "test")
            source.write_text("export const version = 2;", encoding="utf-8")
            with self.assertRaises(ValueError):
                REPORT.current_sources(root, evidence, "test")
            evidence["sourcesUnchangedDuringRun"] = False
            with self.assertRaises(ValueError):
                REPORT.current_sources(root, evidence, "test")

    def test_hash_guard_rejects_path_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            evidence = {
                "sourceHashes": {"../outside.ts": "0" * 64},
                "sourceHashesAfter": {"../outside.ts": "0" * 64},
                "sourcesUnchangedDuringRun": True,
            }
            with self.assertRaises(ValueError):
                REPORT.current_sources(root, evidence, "test")

    def test_freshness_rejects_evidence_before_changed_source(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "result.json"
            path.write_text("{}", encoding="utf-8")
            REPORT.newer_than(path, path.stat().st_mtime, "unchanged")
            with self.assertRaises(ValueError):
                REPORT.newer_than(path, path.stat().st_mtime + 10, "source changed")

    def test_browser_requires_all_files_and_actual_case_outcomes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            specs = root / "apps/web/e2e"
            specs.mkdir(parents=True)
            (specs / "first.spec.ts").write_text(
                "test('first', async () => {});", encoding="utf-8"
            )
            (specs / "second.spec.ts").write_text(
                "test('second', async () => {});", encoding="utf-8"
            )
            (root / "reports").mkdir()
            report = {
                "stats": {"expected": 2, "unexpected": 0, "skipped": 0, "flaky": 0},
                "config": {"argv": ["playwright", "test"], "shard": None},
                "errors": [],
                "suites": [
                    {
                        "specs": [
                            {
                                "file": name,
                                "title": name,
                                "ok": True,
                                "tests": [
                                    {
                                        "status": "expected",
                                        "results": [{"status": "passed"}],
                                    }
                                ],
                            }
                        ]
                    }
                    for name in ("first.spec.ts", "second.spec.ts")
                ],
            }
            (root / "reports/playwright-results.json").write_text(
                json.dumps(report), encoding="utf-8"
            )
            self.assertEqual(len(REPORT.browser_cases(root, report)["cases"]), 2)
            report["suites"].pop()
            with self.assertRaises(ValueError):
                REPORT.browser_cases(root, report)

    def test_browser_rejects_filtered_and_skipped_report(self):
        report = {
            "stats": {"expected": 1, "unexpected": 0, "skipped": 0, "flaky": 0},
            "config": {"argv": ["playwright", "test", "--grep=one"], "shard": None},
            "errors": [],
        }
        with self.assertRaises(ValueError):
            REPORT.browser_cases(pathlib.Path("."), report)
        report["config"]["argv"] = ["playwright", "test"]
        report["stats"]["skipped"] = 1
        with self.assertRaises(ValueError):
            REPORT.browser_cases(pathlib.Path("."), report)


if __name__ == "__main__":
    unittest.main()
