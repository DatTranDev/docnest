"""Validate actual local evidence; --finalize writes reports after all inputs are ready.

Does not execute acceptance tests, change application state or deploy. A historical
benchmark is never treated as a current-runtime pass. Counts come from actual reports.
"""

import argparse
import datetime as dt
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
IMAGES = [
    f"text-editor/{name}:local"
    for name in ("identity-service", "document-service", "processing-service", "web")
]
PASS_REPORTS = (
    "smoke.json",
    "fresh-start.json",
    "infrastructure.json",
    "large-http.json",
    "replay-live.json",
    "backup-restore.json",
    "cloud-backup-local.json",
    "cloud-backup-mysql.json",
    "deployment-static.json",
    "image-secrets.json",
    "maven-dependency-scan.json",
    "secret-scan.json",
    "digest-contract.json",
    "migration-only.json",
)
RUNTIME_REPORTS = (
    "smoke.json",
    "fresh-start.json",
    "infrastructure.json",
    "large-http.json",
    "replay-live.json",
    "backup-restore.json",
    "playwright-results.json",
    "image-secrets.json",
    "image-os-scan.json",
    "migration-only.json",
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path):
    require(path.is_file(), f"Missing evidence: {path}")
    return json.loads(path.read_text(encoding="utf-8-sig"))


def artifact(root, relative):
    path = root / relative
    require(path.is_file(), f"Missing evidence: {relative}")
    return {
        "path": relative,
        "sha256": sha256(path),
        "modifiedAt": dt.datetime.fromtimestamp(
            path.stat().st_mtime, dt.timezone.utc
        ).isoformat(),
    }


def newer_than(path, threshold, reason):
    require(
        path.stat().st_mtime + 2 >= threshold, f"Stale evidence: {path.name}; {reason}"
    )


def current_sources(root, report, name):
    hashes = report.get("sourceHashes")
    require(isinstance(hashes, dict) and hashes, f"{name}: missing source hashes")
    require(
        report.get("sourcesUnchangedDuringRun") is True
        and report.get("sourceHashesAfter") == hashes,
        f"{name}: source changed during measurement",
    )
    for relative, digest in hashes.items():
        path = (root / relative).resolve()
        require(
            path.is_relative_to(root.resolve()) and path.is_file(),
            f"{name}: source missing/outside workspace: {relative}",
        )
        require(
            sha256(path) == digest,
            f"{name}: measured source no longer current: {relative}",
        )


def frontend_counts(log):
    """Associate Vitest summaries with actual workspaces, not their ordinal position."""
    current, counts = None, {}
    for line in ANSI.sub("", log).splitlines():
        workspace = re.match(r"^> (@ted/(?:editor-core|web))@\S+ test$", line.strip())
        if workspace:
            current = workspace.group(1)
        match = re.match(r"^\s*Tests\s+(\d+) passed \((\d+)\)\s*$", line)
        if match:
            require(
                current is not None and current not in counts,
                "Unassociated/duplicate Vitest summary",
            )
            require(
                match.group(1) == match.group(2) and int(match.group(1)) > 0,
                f"{current}: incomplete Vitest run",
            )
            counts[current] = int(match.group(1))
    require(
        set(counts) == {"@ted/editor-core", "@ted/web"},
        "Missing successful core/web Vitest summary",
    )
    return counts


def node_counts(log):
    groups, current = [], {}
    for line in ANSI.sub("", log).splitlines():
        match = re.match(
            r"^\s*(?:#|ℹ)\s+(tests|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$", line
        )
        if not match:
            continue
        key, value = match.group(1), int(match.group(2))
        if key == "tests" and current:
            groups.append(current)
            current = {}
        require(key not in current, f"Duplicate Node test summary field: {key}")
        current[key] = value
    if current:
        groups.append(current)
    require(groups, "Missing executed Node gateway/lint-glob summary")
    for group in groups:
        require(
            set(group) == {"tests", "pass", "fail", "cancelled", "skipped", "todo"},
            "Incomplete Node test summary",
        )
        require(
            group["tests"] > 0
            and group["pass"] == group["tests"]
            and not sum(group[key] for key in ("fail", "cancelled", "skipped", "todo")),
            "Failed, skipped, cancelled or TODO Node tests",
        )
    return {"total": sum(group["tests"] for group in groups), "groups": groups}


def java_suites(root, log, default_log=None, module_logs=None):
    ns = {"m": "http://maven.apache.org/POM/4.0.0"}
    modules = [
        element.text
        for element in ET.parse(root / "pom.xml").findall("m:modules/m:module", ns)
    ]
    require(modules, "Maven reactor modules missing")
    suites, counts, execution_logs = [], {}, {}
    module_logs = module_logs or {}
    require(
        set(module_logs).issubset(set(modules)), "Unknown Maven module log override"
    )
    for module in modules:
        execution_log = log
        if module in module_logs:
            override = root / module_logs[module]
            require(
                override.is_file(),
                f"Missing current module execution log: {module_logs[module]}",
            )
            execution_log = ANSI.sub("", override.read_text(encoding="utf-8-sig"))
            require(
                "BUILD SUCCESS" in execution_log
                and "BUILD FAILURE" not in execution_log
                and not re.search(
                    r"(?:\[ERROR\]|FAIL\s+\S|Traceback \(most recent call last\))",
                    execution_log,
                ),
                f"Replacement module run failed: {module}",
            )
            execution_logs[module] = artifact(root, module_logs[module])
        elif default_log:
            execution_logs[module] = artifact(root, default_log)
        directory = root / module
        files = sorted((directory / "target/surefire-reports").glob("TEST-*.xml"))
        require(files, f"No executed JUnit XML for {module}")
        sources = [root / "pom.xml", directory / "pom.xml"]
        sources += [
            path
            for path in (directory / "src").rglob("*")
            if path.suffix in {".java", ".yml", ".sql"}
        ]
        if directory.name != "common":
            sources += [
                path
                for path in (root / "services/common/src/main").rglob("*")
                if path.is_file()
            ]
            sources.append(root / "services/common/pom.xml")
        latest_source = max(path.stat().st_mtime for path in sources)
        seen = set()
        for path in files:
            suite = ET.parse(path).getroot()
            values = {
                key: int(suite.attrib.get(key, "0"))
                for key in ("tests", "failures", "errors", "skipped")
            }
            name = suite.attrib["name"]
            source = (
                directory
                / "src/test/java"
                / (name.split("$")[0].replace(".", "/") + ".java")
            )
            require(
                source.is_file() and name not in seen,
                f"Stale/duplicate JUnit suite: {name}",
            )
            require(
                f"Running {name}" in execution_log,
                f"JUnit XML absent from current module execution log: {name}",
            )
            require(
                values["tests"] > 0
                and not sum(values[key] for key in ("failures", "errors", "skipped")),
                f"Failed/empty/skipped JUnit suite: {name}",
            )
            cases = suite.findall("testcase")
            require(
                len(cases) == values["tests"]
                and not any(
                    case.find(tag) is not None
                    for case in cases
                    for tag in ("failure", "error", "skipped")
                ),
                f"JUnit testcase outcomes disagree: {name}",
            )
            newer_than(path, latest_source, f"{module} source changed after test run")
            suites.append(
                {
                    "module": module,
                    "suite": name,
                    **values,
                    "seconds": float(suite.attrib.get("time", "0")),
                    "evidence": artifact(root, path.relative_to(root).as_posix()),
                }
            )
            seen.add(name)
        counts[module] = sum(
            suite["tests"] for suite in suites if suite["module"] == module
        )
    return {
        "status": "PASS",
        "total": sum(counts.values()),
        "modules": counts,
        "suites": suites,
        "executionLogs": execution_logs,
        "failures": 0,
        "errors": 0,
        "skipped": 0,
    }


def acceptance(root, relative, module_logs=None):
    path = root / relative
    require(path.is_file(), f"Final acceptance log not ready: {relative}")
    log = ANSI.sub("", path.read_text(encoding="utf-8-sig"))
    require(
        "BUILD SUCCESS" in log and "BUILD FAILURE" not in log,
        "Final acceptance Maven build not successful",
    )
    markers = (
        "checks/validate_kit.py",
        "checks/validate_contracts.py",
        "checks/java_imports.py",
        "checks/pom_format.py",
        "run format:check",
        "All matched files use Prettier code style!",
        "run architecture",
        "PASS frontend boundaries",
        "run typecheck",
        "run lint",
        "checks/next-lint-glob.test.mjs",
        "apps/web/server/gateway.test.mjs",
        "checks/source-sizes.mjs",
        "spotless:",
    )
    for marker in markers:
        require(
            marker in log, f"Final acceptance missing executed quality gate: {marker}"
        )
    require(
        not re.search(
            r"(?:\[ERROR\]|FAIL\s+\S|npm ERR!|Traceback \(most recent call last\))", log
        ),
        "Final acceptance contains a failure",
    )
    return {
        "log": artifact(root, relative),
        "java": java_suites(root, log, relative, module_logs),
        "frontend": frontend_counts(log),
        "node": node_counts(log),
        "quality": "PASS: formatting, explicit imports, POMs, architecture, strict types, lint, source-size review",
    }


def final_quality(root, relative):
    path = root / relative
    require(path.is_file(), f"Final source quality log not ready: {relative}")
    log = ANSI.sub("", path.read_text(encoding="utf-8-sig"))
    require(
        "BUILD SUCCESS" in log
        and "BUILD FAILURE" not in log
        and not re.search(
            r"(?:\[ERROR\]|FAIL\s+\S|npm ERR!|Traceback \(most recent call last\))", log
        ),
        "Final source quality run failed",
    )
    for marker in (
        "-m black --check scripts checks fixtures infra apps/web/benchmark",
        "checks/java_imports.py",
        "checks/pom_format.py",
        "run format:check",
        "All matched files use Prettier code style!",
        "PASS frontend boundaries",
        "run typecheck",
        "run lint",
        "checks/source-sizes.mjs",
        "spotless:",
        "checks/next-lint-glob.test.mjs",
        "apps/web/server/gateway.test.mjs",
    ):
        require(marker in log, f"Final quality log missing executed gate: {marker}")
    roots = (
        "services",
        "apps/web",
        "packages/editor-core",
        "scripts",
        "checks",
        "tools",
        "docs",
        "infra",
        ".github",
    )
    suffixes = {
        ".py",
        ".java",
        ".ts",
        ".tsx",
        ".mjs",
        ".js",
        ".cjs",
        ".json",
        ".yml",
        ".yaml",
        ".css",
        ".md",
        ".html",
    }
    sources = [
        p
        for relative_root in roots
        for p in (root / relative_root).rglob("*")
        if p.is_file()
        and p.suffix in suffixes
        and not (
            {
                "target",
                "node_modules",
                ".next",
                "dist",
                "benchmarks",
                "playwright-report",
                "test-results",
            }
            & set(p.parts)
        )
        and p.name != "next-env.d.ts"
    ]
    sources += [
        root / name
        for name in (
            "README.md",
            "AGENTS.md",
            "AI_AGENT_GUIDE.md",
            "versions.lock.md",
            "package.json",
        )
    ]
    sources += list((root / "fixtures").rglob("*.py"))
    newer_than(
        path,
        max(p.stat().st_mtime for p in sources),
        "handwritten source/docs changed after final quality run",
    )
    return {
        "status": "PASS",
        "log": artifact(root, relative),
        "node": node_counts(log),
        "scope": "Black Python formatting, explicit imports, POM/Prettier formatting, frontend architecture/types/lint, source-size review, gateway/lint contracts and Spotless",
    }


def docker_output(arguments):
    result = subprocess.run(
        ["docker", *arguments], cwd=ROOT, text=True, capture_output=True, timeout=45
    )
    require(
        result.returncode == 0,
        "Docker read-only evidence check failed; daemon/container evidence unavailable",
    )
    return result.stdout.strip()


def runtime_images():
    images = {}
    for reference in IMAGES:
        values = docker_output(
            ["image", "inspect", "--format", "{{.Id}} {{.Created}}", reference]
        ).split()
        require(
            len(values) == 2 and values[0].startswith("sha256:"),
            f"Missing current image: {reference}",
        )
        images[reference] = {"imageId": values[0], "createdAt": values[1]}
    raw = docker_output(
        [
            "compose",
            "--env-file",
            ".env",
            "-f",
            "infra/compose/compose.yaml",
            "--profile",
            "app",
            "ps",
            "--format",
            "json",
        ]
    )
    containers = (
        json.loads(raw)
        if raw.startswith("[")
        else [json.loads(line) for line in raw.splitlines()]
    )
    actual = {}
    for entry in containers:
        reference = f"text-editor/{entry['Service']}:local"
        if reference not in images:
            continue
        values = docker_output(
            [
                "inspect",
                "--format",
                "{{.Image}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}",
                entry["ID"],
            ]
        ).split()
        require(
            values == [images[reference]["imageId"], "running", "healthy"],
            f"{entry['Service']}: healthy running container does not use current image",
        )
        actual[entry["Service"]] = {
            "imageId": values[0],
            "containerId": entry["ID"],
            "status": "healthy",
        }
    require(
        len(actual) == len(images),
        "Not all four current application containers are healthy",
    )
    for reference, image in images.items():
        service = reference.split("/")[1].split(":")[0]
        if service == "web":
            roots = [
                ROOT / "apps/web/src",
                ROOT / "apps/web/server",
                ROOT / "packages/editor-core/src",
            ]
            sources = [
                ROOT / "package-lock.json",
                ROOT / "package.json",
                ROOT / "apps/web/package.json",
                ROOT / "infra/compose/Web.Dockerfile",
                ROOT / "apps/web/next.config.ts",
                ROOT / "apps/web/next.config.mjs",
            ]
        else:
            roots = [
                ROOT / f"services/{service}/src/main",
                ROOT / "services/common/src/main",
            ]
            sources = [
                ROOT / "pom.xml",
                ROOT / f"services/{service}/pom.xml",
                ROOT / "services/common/pom.xml",
                ROOT / f"services/{service}/Dockerfile",
                ROOT / "infra/compose/Service.Dockerfile",
            ]
        sources += [
            path
            for directory in roots
            for path in directory.rglob("*")
            if path.is_file()
        ]
        created = dt.datetime.fromisoformat(
            image["createdAt"].replace("Z", "+00:00")
        ).timestamp()
        require(
            created + 2
            >= max(path.stat().st_mtime for path in sources if path.is_file()),
            f"Current image predates application source: {reference}",
        )
    return {"images": images, "containers": actual}


def benchmarks(root):
    baseline = read_json(root / "reports/refactor-baseline/browser-benchmark.json")
    representative = read_json(root / "reports/refactor-browser-benchmark.json")
    isolated_path = root / "reports/refactor-browser-isolated.json"
    current_report = (
        "reports/refactor-browser-isolated.json"
        if isolated_path.exists()
        else "reports/refactor-browser-benchmark.json"
    )
    after = read_json(root / current_report)
    current_count = 7 if isolated_path.exists() else 3
    for label, report, count in (
        ("baseline", baseline, 7),
        ("representative", representative, 3),
        ("after", after, current_count),
    ):
        require(
            report.get("quick") is False
            and len(report["results"]) == count
            and report["samples"] == 30
            and report["inputSamples"] == 1000
            and report["warmup"] == 5,
            f"{label}: required full benchmark cohort incomplete",
        )
    require(
        after["status"]
        in {
            "MEASURED_WITH_TARGET_MISSES",
            "MEASURED_WITH_UNVERIFIED_TARGETS",
            "MEASURED_TARGETS_PASSED",
        }
        and not after.get("failure"),
        "After benchmark failed/remains in progress",
    )
    require(
        after["runtime"]["framework"] == "Next.js",
        "After benchmark lacks actual Next runtime",
    )
    current_sources(root, after, "After browser benchmark")
    current_sources(
        root, representative, "Earlier representative browser benchmark editor source"
    )
    all_workloads = {
        "ascii-long-line-10MiB.tedoc",
        "million-lines.tedoc",
        "unicode-near-10MiB.tedoc",
        "dense-10MiB.tedoc",
        "styles-10000-10MiB.tedoc",
        "styles-100000-10MiB.tedoc",
        "styles-1000000-10MiB.tedoc",
    }
    require(
        {row["file"] for row in baseline["results"]} == all_workloads,
        "Historical baseline workloads incomplete",
    )
    expected = (
        all_workloads
        if isolated_path.exists()
        else {"ascii-long-line-10MiB.tedoc", "million-lines.tedoc", "dense-10MiB.tedoc"}
    )
    require(
        {row["file"] for row in after["results"]} == expected,
        "Wrong after-refactor workloads",
    )
    identities = set()
    if isolated_path.exists():
        require(
            after["memoryIsolation"] == "per-workload"
            and after["memoryCohort"]["freshBaselinePerWorkload"] is True,
            "Full isolated cohort did not use a fresh empty baseline per workload",
        )
        require(
            after["instrumentationUnchangedDuringRun"] is True
            and after["instrumentationSourceHashes"]
            and after["instrumentationSourceHashes"]
            == after["instrumentationSourceHashesAfter"],
            "Benchmark instrumentation changed during the full run",
        )
        for relative, digest in after["instrumentationSourceHashes"].items():
            path = (root / relative).resolve()
            require(
                path.is_relative_to(root.resolve())
                and path.is_file()
                and sha256(path) == digest,
                f"Current isolated benchmark instrumentation changed: {relative}",
            )
    for row in after["results"]:
        for operation, timing in row["timing"].items():
            require(
                timing["samples"] == (1000 if operation == "input" else 30),
                f"{row['file']}: incomplete {operation} timing cohort",
            )
        sampling = row["memory"]["sampling"]
        require(
            sampling["status"] == "COMPLETED"
            and sampling["completeSamples"] > 1
            and sampling["incompleteSamples"] == 0,
            f"{row['file']}: incomplete actual process-memory samples",
        )
        if isolated_path.exists():
            memory = row["memory"]
            empty = memory["baseline"]["sampling"]
            require(
                memory["strategy"] == "per-workload"
                and empty["status"] == "COMPLETED"
                and empty["completeSamples"] > 1
                and empty["incompleteSamples"] == 0,
                f"{row['file']}: incomplete fresh empty-app baseline",
            )
            require(
                memory["browserProcessId"]
                == sampling["rootProcessId"]
                == empty["rootProcessId"]
                and sampling["rootCreationTimeFileTime"]
                == empty["rootCreationTimeFileTime"]
                and sampling["rootCreationTimeFileTime"],
                f"{row['file']}: baseline/loaded process identity mismatch",
            )
            identity = (sampling["rootProcessId"], sampling["rootCreationTimeFileTime"])
            require(
                identity not in identities,
                f"{row['file']}: memory browser reused across workloads",
            )
            identities.add(identity)
            conditioning = memory["conditioning"]
            require(
                conditioning["warmup"] == 5
                and conditioning["openSamples"] == 30
                and conditioning["inputSamples"] == 1000
                and conditioning["scrollSearchSerializeUndoSamples"] == 30
                and conditioning["requiredLiveBuffersRetained"] is True,
                f"{row['file']}: isolated memory did not replay the same workload",
            )
            dimensions = {
                "utf8Bytes",
                "utf16Length",
                "lines",
                "runs",
                "domLines",
                "domStyleSpans",
                "historyBytes",
                "styleNodes",
            }
            require(
                set(conditioning["matchesTimingDimensions"]) == dimensions
                and all(
                    memory["metrics"][key] == row["metrics"][key] for key in dimensions
                ),
                f"{row['file']}: isolated memory/timing workload dimensions differ",
            )
            require(
                not any(
                    memory["baseline"]["metrics"][key]
                    for key in ("utf8Bytes", "utf16Length", "historyBytes")
                ),
                f"{row['file']}: fresh memory baseline already contains content/history",
            )
            fixture = row["fixture"]
            require(
                fixture["nativeSha256"]
                == fixture["generatedSha256"]
                == fixture["servedSha256"]
                and memory["fixture"]["preparedBytes"]
                == fixture["browserPreparedNativeBytes"]
                and memory["fixture"]["uiText"] == fixture["uiText"],
                f"{row['file']}: fixture identity mismatch",
            )
    comparison = after["comparison"]
    require(
        comparison["baselineReport"]
        == "reports/refactor-baseline/browser-benchmark.json"
        and comparison["baselineMeasuredAt"] == baseline["measuredAt"]
        and {row["file"] for row in comparison["results"]} == expected,
        "After comparison does not identify preserved baseline",
    )
    native = read_json(root / "reports/native-benchmark.json")
    require(
        native["warmup"] == 5
        and native["samples"] == 30
        and len(native["workloads"]) == 4,
        "Native benchmark cohort incomplete",
    )
    dependencies = [
        root / "scripts/benchmark-native.py",
        root / "services/common/pom.xml",
    ]
    dependencies += list((root / "services/common/src/benchmark").rglob("*.java"))
    dependencies += list(
        (root / "services/common/src/main/java/vn/editor/common/codec").rglob("*.java")
    )
    newer_than(
        root / "reports/native-benchmark.json",
        max(path.stat().st_mtime for path in dependencies),
        "relocated native runner/codec/config changed",
    )
    require(
        native["processMemory"]["samples"] > 0
        and native["processMemory"]["peakResidentBytes"] > 0,
        "Native benchmark lacks actual process RAM measurement",
    )
    require(
        native.get("measuredAt") and native.get("sourceHashes"),
        "Native benchmark needs current runner provenance",
    )
    for relative, digest in native["sourceHashes"].items():
        path = (root / relative).resolve()
        require(
            path.is_relative_to(root.resolve())
            and path.is_file()
            and sha256(path) == digest,
            f"Native benchmark source no longer current: {relative}",
        )
    historical = sorted({row["file"] for row in baseline["results"]} - expected)
    return {
        "status": "EXECUTED_WITH_LIMITATIONS",
        "baseline": baseline,
        "after": after,
        "currentReport": current_report,
        "representative": representative,
        "memoryIsolation": after.get("memoryIsolation", "reuse"),
        "comparisonLimitations": "Changing from a reused timing-browser baseline to fresh workload baselines changes the memory cohort. Differences are observations, not causal optimization claims.",
        "native": native,
        "historicalOnlyWorkloads": historical,
        "misses": {
            row["file"]: [
                key for key, value in row["targets"].items() if value is False
            ]
            for row in after["results"]
        },
        "unverifiedTargets": {
            row["file"]: [key for key, value in row["targets"].items() if value is None]
            for row in after["results"]
        },
    }


def browser_cases(root, browser):
    stats = browser["stats"]
    require(
        stats["expected"] > 0
        and not sum(stats[key] for key in ("unexpected", "skipped", "flaky"))
        and not browser.get("errors"),
        "Actual E2E has failures/skips/flaky outcomes",
    )
    require(
        browser["config"].get("shard") is None
        and not any(
            argument.startswith(("--grep", "-g", "--shard", "--last-failed"))
            for argument in browser["config"].get("argv", [])
        ),
        "Final E2E report is a filtered/sharded run",
    )
    cases, files = [], set()

    def walk(suites):
        for suite in suites:
            for spec in suite.get("specs", []):
                files.add(spec["file"])
                require(
                    spec["ok"] is True, f"Unsuccessful browser spec: {spec['title']}"
                )
                for test in spec["tests"]:
                    require(
                        test["status"] == "expected"
                        and len(test["results"]) == 1
                        and test["results"][0]["status"] == "passed",
                        f"Incomplete/retried E2E case: {spec['title']}",
                    )
                    cases.append({"file": spec["file"], "title": spec["title"]})
            walk(suite.get("suites", []))

    walk(browser.get("suites", []))
    sources = list((root / "apps/web/e2e").glob("*.spec.ts"))
    require(
        files == {path.name for path in sources} and len(cases) == stats["expected"],
        "Final E2E report does not cover every current specification file/case",
    )
    browser_sources = list((root / "apps/web/e2e").rglob("*.ts"))
    newer_than(
        root / "reports/playwright-results.json",
        max(path.stat().st_mtime for path in browser_sources),
        "browser specification changed after execution",
    )
    return {
        "stats": stats,
        "cases": cases,
        "scope": "full actual Chromium suite against current local application/services",
    }


def collect(root, acceptance_log, quality_log, module_logs=None):
    gates = acceptance(root, acceptance_log, module_logs)
    quality = final_quality(root, quality_log)
    gates["acceptanceNode"] = gates["node"]
    gates["node"] = quality["node"]
    gates["finalQuality"] = quality
    reports = {name: read_json(root / "reports" / name) for name in PASS_REPORTS}
    for name, report in reports.items():
        require(
            report.get("status") == "PASS", f"Required local evidence not PASS: {name}"
        )
    browser = read_json(root / "reports/playwright-results.json")
    e2e = browser_cases(root, browser)
    worker = read_json(root / "reports/worker-contract.json")
    require(
        worker["status"] == "PASS"
        and worker["checks"]
        and all(check["status"] == "PASS" for check in worker["checks"]),
        "Actual Worker protocol failure",
    )
    current_sources(root, worker, "Worker contract")
    require(
        worker["directNavigation"]["status"] == "PASS"
        and worker["directNavigation"]["httpStatus"] == 200
        and worker["lifecycle"]["status"] == "PASS"
        and worker["lifecycle"]["remainingDedicatedWorkers"] == 0
        and worker["hydration"]["status"] == "PASS"
        and not worker["hydration"]["pageErrors"]
        and not worker["hydration"]["hydrationErrors"],
        "Next route/hydration/Worker lifecycle failure",
    )
    acl = read_json(root / "reports/kafka-acl-check.json")
    require(
        acl["passed"] is True
        and acl["checks"]
        and all(check["passed"] for check in acl["checks"]),
        "Real broker ACL checks incomplete",
    )
    require(
        reports["fresh-start.json"]["isolatedProjectCleanupPassed"] is True,
        "Fresh-start cleanup failed",
    )
    replay = reports["replay-live.json"]
    require(
        replay["eventIdRetained"]
        and replay["consumerLagZero"]
        and replay["inboxReceiptCount"] == 1
        and replay["previewJobCountUnchanged"],
        "Replay/dedup evidence incomplete",
    )
    backup = reports["backup-restore.json"]
    require(
        backup["databasesRestored"] == 3
        and all(
            backup[key] is True
            for key in (
                "originalCountsRestored",
                "postBackupMarkerRemoved",
                "immutableNativeHashPreserved",
                "signingKeyPreserved",
            )
        ),
        "Actual three-DB/object/key restore incomplete",
    )
    require(
        all(
            row["reopenedSha256Matches"] is True
            for row in reports["large-http.json"]["results"]
        ),
        "Large native HTTP hash mismatch",
    )
    require(
        not reports["maven-dependency-scan.json"]["findings"]
        and not reports["maven-dependency-scan.json"]["unresolved"],
        "Runtime vulnerability scan incomplete",
    )
    npm = read_json(root / "reports/refactor-npm-audit.json")
    require(
        npm["metadata"]["vulnerabilities"]["total"] == 0 and not npm["vulnerabilities"],
        "npm audit has findings",
    )
    newer_than(
        root / "reports/refactor-npm-audit.json",
        (root / "package-lock.json").stat().st_mtime,
        "lockfile changed",
    )
    scan = read_json(root / "reports/image-os-scan.json")
    require(
        scan["highCriticalGate"] == "PASS"
        and not scan["pendingImages"]
        and set(scan["requiredImages"]) == set(IMAGES),
        "Incomplete/failing OS image scans",
    )
    runtime = runtime_images()
    migrations = reports["migration-only.json"]["cases"]
    require(
        len(migrations) == 3
        and {case["service"] for case in migrations}
        == {"identity-service", "document-service", "processing-service"},
        "Migration-only service coverage incomplete",
    )
    for case in migrations:
        require(
            case["status"] == "PASS"
            and case["exitCode"] == 0
            and case["historyUnchanged"] is True
            and case["runtimeStartupMarkersAbsent"] is True,
            f"Actual cloud-profile migration-only check failed: {case['service']}",
        )
        require(
            case["imageId"]
            == runtime["images"][f"text-editor/{case['service']}:local"]["imageId"],
            f"Migration-only runner used stale image: {case['service']}",
        )
        for relative, digest in case["sourceHashes"].items():
            path = (root / relative).resolve()
            require(
                path.is_relative_to(root.resolve())
                and path.is_file()
                and sha256(path) == digest,
                f"Migration-only source changed after execution: {relative}",
            )
    for collection, key in (
        (reports["image-secrets.json"]["images"], "image"),
        (scan["scans"], "reference"),
    ):
        require(
            {row[key] for row in collection} == set(IMAGES),
            "Image evidence misses an application image",
        )
        for row in collection:
            require(
                row["imageId"] == runtime["images"][row[key]]["imageId"],
                f"Stale image scan: {row[key]}",
            )
    for row in reports["image-secrets.json"]["images"]:
        require(
            all(
                row[key] is True
                for key in (
                    "nonRoot",
                    "generatedCredentialsAbsent",
                    "privatePemPayloadAbsent",
                )
            ),
            "Image nonroot/secret check failure",
        )
    floor = max(
        dt.datetime.fromisoformat(image["createdAt"].replace("Z", "+00:00")).timestamp()
        for image in runtime["images"].values()
    )
    for name in RUNTIME_REPORTS:
        newer_than(
            root / "reports" / name, floor, "current image built after runtime evidence"
        )
    packaged = [
        root / f"services/{service}/target/{service}-1.0.0-SNAPSHOT.jar"
        for service in ("identity-service", "document-service", "processing-service")
    ]
    require(all(path.is_file() for path in packaged), "Missing packaged service jar")
    newer_than(
        root / "reports/maven-dependency-scan.json",
        max(path.stat().st_mtime for path in packaged),
        "packaged jars rebuilt after scan",
    )
    performance = benchmarks(root)
    native_files = {row["file"] for row in performance["native"]["workloads"]}
    http_results = reports["large-http.json"]["results"]
    require(
        len(http_results) == len(native_files) == 4
        and {row["workload"] for row in http_results} == native_files,
        "Native and real HTTP probes do not cover all four required large workloads",
    )
    baseline = read_json(root / "reports/refactor-baseline/baseline.json")
    plan = read_json(root / "docs/implementation-plan.json")
    require(
        {step["id"] for step in plan} == {f"P{index:02}" for index in range(17)},
        "Plan incomplete",
    )
    details = {
        "P00": (
            "DONE",
            "Reactor/Next builds, contracts, quality and current source/image secret checks.",
        ),
        "P01": (
            "DONE",
            "Real owned databases, Flyway, cross-database denials and SQL/Kafka restart persistence.",
        ),
        "P02": (
            "DONE",
            "Actual SQL/HTTP/Redis authentication tests; JWT/CSRF/rotation/reuse/logout/login limit.",
        ),
        "P03": (
            "DONE",
            "Folders/metadata, tree locks, quotas, trash/restore; real SQL and browser flows.",
        ),
        "P04": (
            "DONE",
            "Core properties, shared native fixtures, Java codec, Unicode/style/history/IME/clipboard.",
        ),
        "P05": (
            "DONE",
            "Actual local save/reopen, immutable history, idempotency, conflicts and pinned saves.",
        ),
        "P06": (
            "DONE",
            "Two-account VIEWER/EDITOR/public link, revocation, attribution and authorization.",
        ),
        "P07": (
            "DONE",
            "Actual Next workspace/browser flows, moves, version history and owned copies.",
        ),
        "P08": (
            "DONE",
            "Real Workers, App Router lifecycle, offline IndexedDB recovery and autosave conflicts.",
        ),
        "P09": (
            "DONE",
            "Real outbox/inbox/replay/DLQ failure tests and authenticated scoped Kafka ACLs.",
        ),
        "P10": (
            "DONE",
            "Actual SQL concurrency/leases/deadlines/cancellation; preview and TXT/HTML exports.",
        ),
        "P11": (
            "EXECUTED_WITH_LIMITATIONS",
            f"Seven original workloads; {len(performance['after']['results'])} current Next workloads; measured targets retained and 8 GiB device unverified.",
        ),
        "P12": (
            "PENDING",
            "Adapter/config/local protocol/restore contracts implemented; real credentials/IAM/GCS pending.",
        ),
        "P13": (
            "DONE_LOCAL",
            "Four current images, fresh startup and local scans; CI configured, remote CI/push unexecuted.",
        ),
        "P14": (
            "DEPLOY_PENDING",
            "VM/Terraform/IAM/migrations/backup/rollback/cost/cleanup prepared; no cloud deployment.",
        ),
        "P15": (
            "DEPLOY_PENDING",
            "Kustomize/digest/health/rollback/cleanup prepared; cluster/API/rollout pending.",
        ),
        "P16": (
            "NOT_RUN",
            "Optional exercise deferred; local MVP uses contracted internal HTTP interfaces.",
        ),
    }
    steps = [
        {
            "id": step["id"],
            "title": step["title"],
            "status": details[step["id"]][0],
            "evidence": details[step["id"]][1],
        }
        for step in plan
    ]
    names = list(PASS_REPORTS) + [
        "playwright-results.json",
        "worker-contract.json",
        "kafka-acl-check.json",
        "refactor-npm-audit.json",
        "image-os-scan.json",
        "refactor-browser-benchmark.json",
        "native-benchmark.json",
        "refactor-baseline/baseline.json",
        "refactor-baseline/browser-benchmark.json",
    ]
    if performance["currentReport"] != "reports/refactor-browser-benchmark.json":
        names.append(pathlib.Path(performance["currentReport"]).name)
    return {
        "recordedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "acceptance": gates,
        "runtime": runtime,
        "e2e": e2e,
        "worker": {
            key: worker[key]
            for key in (
                "status",
                "runtime",
                "checks",
                "directNavigation",
                "lifecycle",
                "hydration",
            )
        },
        "reports": reports,
        "kafkaAcl": acl,
        "npmAudit": {"status": "PASS", "vulnerabilities": 0},
        "imageOs": scan,
        "performance": performance,
        "baseline": baseline,
        "steps": steps,
        "artifacts": [artifact(root, "reports/" + name) for name in names],
        "cloud": {
            "gcs": "PENDING",
            "vm": "DEPLOY_PENDING",
            "gke": "DEPLOY_PENDING",
            "clusterApiDryRun": "NOT_RUN",
            "remoteCi": "NOT_RUN",
            "registryPush": "NOT_RUN",
            "remoteBackupRestore": "NOT_RUN",
            "grpcOptional": "NOT_RUN",
            "totalBudgetUsd": 300,
        },
        "provenance": "Evidence hashes and actual image IDs only; no Git SHA or full source archive claimed.",
    }


def step_table(e):
    return ["| Step | Status | Evidence / remaining work |", "| --- | --- | --- |"] + [
        f"| {step['id']} — {step['title']} | {step['status']} | {step['evidence']} |"
        for step in e["steps"]
    ]


def render_report(e):
    a, reports, p = e["acceptance"], e["reports"], e["performance"]
    modules = ", ".join(
        f"{pathlib.Path(module).name}: {count}"
        for module, count in a["java"]["modules"].items()
    )
    scan = e["imageOs"]
    lines = [
        "# Project status and implementation evidence",
        "",
        f"Recorded: {e['recordedAt']}.",
        "",
        "The required local application and deployment preparation are implemented. The refactor uses Next.js App Router, feature-owned React components/hooks, pragmatic backend DDD and command/query ports. Current acceptance and real-service checks passed as recorded below. Performance misses remain explicit; real GCS, VM/GKE deployment and remote CI have not run. No paid resources, billing changes or cloud deployments were created. The total learning budget remains USD 300.",
        "",
        "## Build and run",
        "",
        "After README.md prerequisites (Python 3.12.6+, Docker Linux containers/Compose, port 8080; Java 21 and pinned Node/npm for development), run:",
        "",
        "```text",
        "python -X utf8 scripts/run.py up",
        "```",
        "",
        "Open http://localhost:8080. Ignored .env is generated; database/object/Kafka/signing-key volumes persist. Build: `python -X utf8 scripts/run.py build`. Quality: `python -X utf8 scripts/run.py quality`. Tests: `python -X utf8 scripts/run.py test`. HTTP: `python -X utf8 scripts/run.py smoke`. E2E: `python -X utf8 scripts/run.py e2e`. Full browser benchmark: `python -X utf8 scripts/run.py benchmark`. Native: `python -X utf8 scripts/benchmark-native.py`. Shutdown preserving data: `python -X utf8 scripts/run.py down`. README documents installation and representative comparison commands.",
        "",
        "## Delivered behavior",
        "",
        "Authentication includes Argon2id, RS256 issuer/audience/expiry checks, CSRF, refresh rotation/reuse revocation with absolute family expiry, logout, and atomic Redis limiting of ten login attempts per IP per minute. Private folders/documents support tree/quota rules, rename/move, trash and restoration. Bold/italic/underline survive native save/reopen. The editor provides undo/redo, search/replace, styled internal clipboard, Unicode IME groups, version history, conflicts, autosave and offline IndexedDB drafts. VIEWER/EDITOR sharing, revocation and read-only public links enforce SQL authorization. Durable outbox/inbox processing and bounded leased jobs generate previews and escaped TXT/HTML exports.",
        "",
        "Identity auth, Document folders/documents/sharing and Processing jobs have API, application command/query/port, plain Java domain, infrastructure and bootstrap layers. Common contains technical codec/storage/messaging/observability code. Safe JSON request logs, trace propagation and HTTP/Kafka/job metrics preserve private data and event contracts. Processing V3 persists nullable trace correlation. AGENTS.md, ADR019, architecture and versions.lock.md document enforced boundaries and compatible quality pins.",
        "",
        "## Executed checks",
        "",
        "| Evidence | Result |",
        "| --- | --- |",
        f"| Current JUnit XML plus per-module execution logs below | {a['java']['total']} combined actual cases ({modules}); zero failures/errors/skips. Replacement module runs retain their own provenance. |",
        f"| {a['log']['path']} | Full acceptance execution includes core {a['frontend']['@ted/editor-core']} and web {a['frontend']['@ted/web']}; its Node run had {a['acceptanceNode']['total']} cases. Current Java counts are derived from the latest applicable module XML/logs. |",
        f"| {a['finalQuality']['log']['path']} | Final source formatting/import/POM/architecture/type/lint/Spotless gates passed; {a['node']['total']} actual current Node gateway/lint-glob cases passed, no skips/failures. |",
        f"| playwright-results.json | {e['e2e']['stats']['expected']} actual Chromium cases; zero unexpected/skipped/flaky; {e['e2e']['stats']['duration']/1000:.1f}s. |",
        f"| worker-contract.json | {len(e['worker']['checks'])} actual Worker protocol checks; {e['worker']['lifecycle']['appRouterNavigations']} same-context App Router navigations, direct HTTP 200, no hydration/page errors or leaked Workers. |",
        f"| smoke.json / large-http.json | {len(reports['smoke.json']['checks'])} actual HTTP scenario groups; {len(reports['large-http.json']['results'])} large native upload/commit/reopen probes with exact SHA256. |",
        f"| infrastructure.json / kafka-acl-check.json / replay-live.json | {len(reports['infrastructure.json']['checks'])} database/migration/restart checks; {len(e['kafkaAcl']['checks'])} authenticated broker ACL checks; retained eventId, lag zero, one inbox receipt and no duplicate job. |",
        f"| fresh-start.json / backup-restore.json | Isolated empty-volume startup/cleanup in {reports['fresh-start.json']['startupAndProbeSeconds']:.1f}s. Actual three-DB/object/key restore preserved hashes/key and removed the post-backup marker. |",
        f"| migration-only.json | {len(reports['migration-only.json']['cases'])} actual current-image cloud-profile Flyway-only runners against local owned SQL, exit zero and unchanged history; unavailable runtime keys/broker/storage did not initialize. No cloud integration. |",
        f"| cloud-backup-local.json / cloud-backup-mysql.json | {reports['cloud-backup-local.json']['tests']} offline archive/reference checks; {len(reports['cloud-backup-mysql.json']['checks'])} real isolated MySQL checks ({reports['cloud-backup-mysql.json']['scope']}). No remote restore. |",
        f"| deployment-static.json / digest-contract.json | {len(reports['deployment-static.json']['checks'])} offline groups; {reports['digest-contract.json']['checks']} digest checks; source migration inventories match. Cloud/API dry-run pending. |",
        f"| Dependency/image security | OSV {reports['maven-dependency-scan.json']['packagesQueried']} packaged runtime packages: zero findings/unresolved. npm: zero findings. Four current nonroot/image-secret checks and High/Critical OS scan gate passed. |",
        "",
        f"OS scans retain {scan['severityCountsAcrossImages']} repeated package/image findings, {scan['uniqueCveCount']} distinct CVEs and {scan['fixableFindingsAcrossImages']} listed fixable findings. Current image IDs/scanner DB/findings are in reports/image-os-scan.json. Infrastructure images are outside the scan. Historical failed logs remain; configured GitHub workflows have not run remotely.",
        "",
        "## Current Java execution provenance",
        "",
        "| Module | Cases | Actual execution log |",
        "| --- | ---: | --- |",
    ]
    for module, count in a["java"]["modules"].items():
        lines.append(
            f"| {module} | {count} | {a['java']['executionLogs'][module]['path']} |"
        )
    lines += [
        "",
        "The real-service run exposed a Spring repository-proxy field-access failure in Processing; constructor-owned dependencies and a real proxied MySQL/native-worker regression now cover it. Earlier intermittent native-download502 failures are retained in the validation history. The exact transport cause was not proven: a separate100-request10MiB reopen probe passed, and the gateway now has tested, bounded recovery for an empty read reset on a reused socket. Current full-service gates above are separate executed evidence; they do not establish that every possible transport failure is eliminated.",
        "",
        "## Performance measurements",
        "",
        f"The preserved original baseline covers seven workloads; production Next.js {p['after']['runtime']['version']} covers {len(p['after']['results'])} current workloads after refactoring ({p['currentReport']}; memory strategy {p['memoryIsolation']}). Each uses five warmups/thirty timing samples/1000 input samples. Current host: {p['after']['cpu']}, {p['after']['ramBytes']/1073741824:.2f} GiB, {p['after']['os']}, Chromium {p['after']['browser']}, Node {p['after']['node']}. An 8 GiB reference-device run is unverified.",
        "",
        "| Current Next workload | Open p95 ms | Input p95/p99 ms | Scroll p95/p99 ms | Search p95 ms | Serialize p95 ms | Undo p95 ms | Steady/observed peak MiB | DOM lines/spans |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in p["after"]["results"]:
        t, m, v = row["timing"], row["memory"], row["metrics"]
        lines.append(
            f"| {row['file']} | {t['open']['p95']:.1f} | {t['input']['p95']:.1f}/{t['input']['p99']:.1f} | {t['scroll']['p95']:.1f}/{t['scroll']['p99']:.1f} | {t['search']['p95']:.1f} | {t['serialization']['p95']:.1f} | {t['undoRedo']['p95']:.1f} | {m['steadyDeltaMiB']:.1f}/{m['peakObservedDeltaMiB']:.1f} | {v['domLines']}/{v['domStyleSpans']} |"
        )
    lines += ["", "Current failed or unverified targets:", ""]
    for file, misses in p["misses"].items():
        if misses:
            lines.append(f"- {file}: failed {', '.join(misses)}.")
    for file, unverified in p["unverifiedTargets"].items():
        if unverified:
            lines.append(f"- {file}: unverified {', '.join(unverified)}.")
    coverage = (
        (
            "Workloads not rerun after refactoring: "
            + ", ".join(p["historicalOnlyWorkloads"])
            + "."
        )
        if p["historicalOnlyWorkloads"]
        else "All seven required workloads have current Next.js measurements."
    )
    lines += [
        "",
        coverage
        + " Original seven-workload results/misses remain historical under refactor-baseline. The earlier three-workload Next cohort remains in refactor-browser-benchmark.json with the reused-browser memory strategy. "
        + p["comparisonLimitations"],
        "",
        "| Preserved original workload (historical runtime) | Open p95 ms | Steady/observed peak MiB | Failed or unverified targets |",
        "| --- | ---: | ---: | --- |",
    ]
    for row in p["baseline"]["results"]:
        misses = (
            ", ".join(key for key, value in row["targets"].items() if value is not True)
            or "None on measured host"
        )
        lines.append(
            f"| {row['file']} | {row['timing']['open']['p95']:.1f} | {row['memory']['steadyDeltaMiB']:.1f}/{row['memory']['peakObservedDeltaMiB']:.1f} | {misses} |"
        )
    lines += [
        "",
        "| Matched cohort | Open p95 before → after ms | Input p95 before → after ms | Steady RAM before → after MiB |",
        "| --- | ---: | ---: | ---: |",
    ]
    for row in p["after"]["comparison"]["results"]:
        opening, typing, memory = (
            row["timing"]["open"]["p95"],
            row["timing"]["input"]["p95"],
            row["steadyDeltaMiB"],
        )
        lines.append(
            f"| {row['file']} | {opening['before']:.1f} → {opening['after']:.1f} | {typing['before']:.1f} → {typing['after']:.1f} | {memory['before']:.1f} → {memory['after']:.1f} |"
        )
    lines += [
        "",
        "Browser RAM sums actual browser/renderer/worker working sets in a separate cohort. Shared pages may be counted repeatedly and polling may miss brief spikes: observed peak is a lower bound. Input-to-paint excludes hardware/OS latency. Full distributions, sampling intervals, source hashes and target outcomes remain in JSON and ADR016.",
        "",
        "| Native Java workload | p50/p95/p99 ms | Native bytes | HTTP upload/commit seconds |",
        "| --- | ---: | ---: | ---: |",
    ]
    for row in p["native"]["workloads"]:
        http = next(
            item
            for item in reports["large-http.json"]["results"]
            if item["workload"] == row["file"]
        )
        lines.append(
            f"| {row['file']} | {row['p50Ms']:.1f}/{row['p95Ms']:.1f}/{row['p99Ms']:.1f} | {row['nativeBytes']} | {http['uploadSeconds']:.3f}/{http['commitWithValidationSeconds']:.3f} |"
        )
    lines += [
        "",
        f"Native validation: five warmups/thirty samples; whole JVM observed peak {p['native']['processMemory']['peakResidentBytes']/1048576:.1f} MiB. The native benchmark is a test harness excluded from runtime images. HTTP timings are functional probes, not percentiles/cloud SLA measurements.",
        "",
        "## Plan status",
        "",
        *step_table(e),
        "",
        "## Remaining limitations and cloud handoff",
        "",
        "Performance misses and the untested 8 GiB device remain. Cold offline application reload has no service-worker shell cache; existing-session offline editing/reconnect recovery is exercised. Real GCS IAM/CORS/generation/GC, VM/GKE rollout/HTTPS/server dry-run/remote restore/cost/cleanup require credentials and remain pending. Optional gRPC and remote CI/OIDC/registry push have not run.",
        "",
        "docs/CLOUD_SETUP_HANDOFF.md lists every project/bucket/domain/secret/key/image/OIDC/IAM placeholder, placement, ordered deployment/migration/validation commands, cost estimate, backup/restore, rollback and cleanup. No cloud gate is inferred from local contracts/static checks. Any generated local backup data stays under ignored reports/raw and is excluded from CI artifacts.",
        "",
        "This file is the sole human-readable project status checkpoint. Machine-readable acceptance evidence remains only where referenced by validation and deployment documentation; generated logs are disposable. No Git SHA or full-source archive is claimed.",
    ]
    return "\n".join(lines) + "\n"


def write_reports(root, e):
    directory = root / "reports"
    # Render before publishing so an incomplete evidence set leaves the checkpoint intact.
    report = render_report(e)
    (directory / "progress.md").write_text(report, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--finalize",
        action="store_true",
        help="Write reports only after all local evidence validates",
    )
    parser.add_argument("--acceptance-log", default="reports/refactor-acceptance.log")
    parser.add_argument("--quality-log", default="reports/refactor-quality-final.log")
    parser.add_argument(
        "--module-log",
        action="append",
        default=[],
        metavar="MODULE=PATH",
        help="Current complete targeted-module rerun replacing its XML from full acceptance; repeatable",
    )
    args = parser.parse_args()
    try:
        overrides = {}
        for value in args.module_log:
            module, separator, path = value.partition("=")
            require(
                separator and module and path and module not in overrides,
                "Invalid/duplicate --module-log",
            )
            overrides[module] = path
        evidence = collect(ROOT, args.acceptance_log, args.quality_log, overrides)
        if args.finalize:
            write_reports(ROOT, evidence)
        print(
            f"{'Wrote final reports' if args.finalize else 'Validated inputs; no reports written'}: "
            f"{evidence['acceptance']['java']['total']} JUnit; performance/cloud limits retained"
        )
    except (
        ValueError,
        KeyError,
        OSError,
        ET.ParseError,
        subprocess.SubprocessError,
    ) as error:
        print(f"REPORT NOT FINALIZED: {error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
