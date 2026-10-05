"""Render measured baseline/after evidence without promoting stale validation gates."""

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BASELINE = "reports/refactor-baseline/browser-benchmark.json"
AFTER = "reports/refactor-browser-benchmark.json"
ISOLATED = "reports/refactor-browser-isolated.json"
REPRESENTATIVES = {
    "ascii-long-line-10MiB.tedoc",
    "million-lines.tedoc",
    "dense-10MiB.tedoc",
}


def read(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def digest(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sources_match(report):
    hashes = report.get("sourceHashes", {})
    return bool(hashes) and all(
        (ROOT / path).is_file() and digest(path) == expected
        for path, expected in hashes.items()
    )


def validate(report, historical=False):
    require(
        not report.get("quick"), "Quick smoke measurements are not acceptance cohorts"
    )
    require(
        (report["warmup"], report["samples"], report["inputSamples"]) == (5, 30, 1000),
        "Acceptance requires five warmups, thirty timing samples and 1000 inputs",
    )
    require(
        report.get("failure") is None, "Failed runs cannot become completed evidence"
    )
    files = [result["file"] for result in report["results"]]
    require(len(files) == len(set(files)), "Duplicate workload measurements")
    if historical:
        require(
            len(files) == 7, "The archived full baseline must contain seven workloads"
        )
    else:
        require(report["status"].startswith("MEASURED_"), "The after run is incomplete")
        require(
            len(files) == len(report["selectedWorkloads"])
            and set(files) == set(report["selectedWorkloads"]),
            "Incomplete selected workloads",
        )
        require(
            REPRESENTATIVES <= set(files),
            "The three representative workloads are required",
        )
        require(
            report["runtime"]["framework"] == "Next.js", "Expected production Next.js"
        )
        require(report["runtime"]["bundler"] == "webpack", "Unexpected worker bundler")
        require(
            report["sourcesUnchangedDuringRun"] is True,
            "Sources changed during measurement",
        )
        require(
            report["sourceHashes"] == report["sourceHashesAfter"],
            "Source digest mismatch during run",
        )
    for result in report["results"]:
        for metric, timing in result["timing"].items():
            require(
                timing["samples"] == (1000 if metric == "input" else 30),
                f"Incomplete {result['file']} {metric} cohort",
            )
        sampler = result["memory"]["sampling"]
        require(
            sampler["status"] == "COMPLETED"
            and sampler["completeSamples"] >= 2
            and sampler["incompleteSamples"] == 0,
            f"Incomplete OS memory measurement for {result['file']}",
        )
        if not historical:
            fixture = result["fixture"]
            require(
                fixture["nativeSha256"]
                == fixture["generatedSha256"]
                == fixture["servedSha256"],
                f"Native identity differs for {result['file']}",
            )
            require(
                fixture["uiText"]["sha256"] == fixture["manifest"]["textSha256"],
                f"UI text identity differs for {result['file']}",
            )
            for dimension in ("utf8Bytes", "utf16Length", "logicalLines"):
                require(
                    fixture["uiText"][dimension] == fixture["manifest"][dimension],
                    f"UI {dimension} differs for {result['file']}",
                )


def table(results):
    lines = [
        "| Workload | Open p95 ms | Input p95/p99 ms | Scroll p95/p99 ms | Search p95 ms | Serialize p95 ms | Undo p95 ms | Steady/sampled peak delta MiB | DOM lines/spans |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for result in results:
        t, m, v = result["timing"], result["memory"], result["metrics"]
        lines.append(
            f"| {result['file']} | {t['open']['p95']:.1f} | {t['input']['p95']:.1f}/{t['input']['p99']:.1f} "
            f"| {t['scroll']['p95']:.1f}/{t['scroll']['p99']:.1f} | {t['search']['p95']:.1f} "
            f"| {t['serialization']['p95']:.1f} | {t['undoRedo']['p95']:.1f} "
            f"| {m['steadyDeltaMiB']:.1f}/{m['peakObservedDeltaMiB']:.1f} | {v['domLines']}/{v['domStyleSpans']} |"
        )
    return lines


def misses(results):
    lines = []
    for result in results:
        for status, label in ((False, "unmet"), (None, "unverified")):
            names = [
                name for name, value in result["targets"].items() if value is status
            ]
            if names:
                lines.append(f"- {result['file']}: {label} {', '.join(names)}.")
    return lines or ["- All recorded targets met in this cohort."]


def passing(results):
    return ", ".join(
        name
        for name in results[0]["targets"]
        if all(result["targets"][name] is True for result in results)
    )


def comparison(before, after):
    old = {result["file"]: result for result in before["results"]}
    lines = [
        "| Repeated workload | Open p95 before → after ms | Input p95 before → after ms | Scroll p95 before → after ms | Undo p95 before → after ms | Steady delta before → after MiB | Sampled peak delta before → after MiB |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for result in after["results"]:
        prior = old[result["file"]]
        values = [
            f"{prior['timing'][name]['p95']:.1f} → {result['timing'][name]['p95']:.1f}"
            for name in ("open", "input", "scroll", "undoRedo")
        ] + [
            f"{prior['memory'][name]:.1f} → {result['memory'][name]:.1f}"
            for name in ("steadyDeltaMiB", "peakObservedDeltaMiB")
        ]
        lines.append(f"| {result['file']} | " + " | ".join(values) + " |")
    return lines


def additional_evidence():
    lines = []
    native_path = "reports/native-benchmark.json"
    if (ROOT / native_path).is_file():
        native = read(native_path)
        execution = native.get("measuredAt", native.get("executedAt"))
        modified = datetime.fromtimestamp(
            (ROOT / native_path).stat().st_mtime, timezone.utc
        ).isoformat()
        provenance = (
            f"execution time {execution}"
            if execution
            else f"execution timestamp absent; file modification time {modified}"
        )
        cases = ", ".join(
            f"{r['file']}: {r['p95Ms']:.1f} ms" for r in native["workloads"]
        )
        passed = sum(
            r.get("validationP95Target3000ms") is True for r in native["workloads"]
        )
        native_current = sources_match(native)
        source_note = (
            "Recorded source digests match current files."
            if native_current
            else "No matching current-source digest manifest; execution provenance alone is not source equivalence."
        )
        lines += [
            f"Java native validation ({provenance}), Java {native['java']}, Unicode {native['unicode']}, "
            f"{native['warmup']} warmups/{native['samples']} samples: {cases}. "
            f"{passed}/{len(native['workloads'])} recorded cases meet the local 3 s hypothesis. "
            f"{source_note} This CLI excludes HTTP/SQL and is not a cloud SLA. "
            f"Evidence: [{native_path}](../{native_path}).",
            "",
        ]
    else:
        lines += ["Java native validation: NOT_RUN; report absent.", ""]
    worker_path = "reports/worker-contract.json"
    if (ROOT / worker_path).is_file():
        worker = read(worker_path)
        lifecycle = worker.get("lifecycle", {})
        checks = worker.get("checks", [])
        passed = sum(check.get("status") == "PASS" for check in checks)
        source_note = (
            "yes"
            if sources_match(worker)
            else "no; rerun required for current-source evidence"
        )
        # Earlier reports omitted these assertions; absence does not mean PASS.
        hydration = worker.get("hydration")
        direct = worker.get("directNavigation")
        hydration_note = (
            f"{hydration['status']}, {len(hydration['pageErrors'])} page errors, "
            f"{len(hydration['hydrationErrors'])} hydration errors"
            if hydration
            else "NOT_RECORDED"
        )
        direct_note = (
            f"{direct['status']}, HTTP {direct['httpStatus']}, hydrated client bridge "
            f"{direct['hydratedClientBridge']}"
            if direct
            else "NOT_RECORDED"
        )
        lines += [
            f"Production worker execution {worker.get('executedAt', 'timestamp absent')}: overall "
            f"{worker.get('status', 'UNVERIFIED')}, {passed}/{len(checks)} dedicated-worker protocol "
            f"checks PASS; App Router lifecycle {lifecycle.get('status', 'NOT_RUN')}, "
            f"{lifecycle.get('appRouterNavigations', 0)} client navigations, "
            f"{lifecycle.get('remainingDedicatedWorkers', 'unrecorded')} dedicated workers after unmount. "
            f"Hydration: {hydration_note}. Direct navigation: {direct_note}. "
            f"Recorded source digests match current files: {source_note}. Actual production webpack "
            f"workers run without mocks. Evidence: [{worker_path}](../{worker_path}).",
            "",
        ]
    else:
        lines += ["Production worker contracts: NOT_RUN; report absent.", ""]
    browser_path = "reports/playwright-results.json"
    if (ROOT / browser_path).is_file():
        stats = read(browser_path)["stats"]
        old = read("reports/refactor-baseline/playwright-results.json")["stats"]
        scope = (
            "This is the archived pre-refactor execution, not a fresh Next.js full-service gate."
            if stats["startTime"] == old["startTime"]
            else "This execution is later than the archived pre-refactor browser gate."
        )
        lines += [
            f"Full-service Playwright started {stats['startTime']}: {stats['expected']} expected/pass, "
            f"{stats['unexpected']} unexpected/fail, {stats['skipped']} skipped, {stats['flaky']} flaky, "
            f"{stats['duration'] / 1000:.1f} seconds. {scope} Tests use real services and browser APIs; "
            f"timing interceptors continue requests to backends. Evidence: [{browser_path}](../{browser_path}).",
            "",
        ]
    else:
        lines += ["Full-service browser validation: NOT_RUN; report absent.", ""]
    return lines


def main():
    global AFTER
    isolated = (ROOT / ISOLATED).is_file()
    if isolated:
        AFTER = ISOLATED
    before, after = read(BASELINE), read(AFTER)
    validate(before, historical=True)
    validate(after)
    if isolated:
        require(
            after["memoryIsolation"] == "per-workload" and len(after["results"]) == 7,
            "The isolated cohort must measure all seven workloads with fresh browsers",
        )
    old_files = {result["file"] for result in before["results"]}
    after_files = {result["file"] for result in after["results"]}
    require(after_files <= old_files, "Comparison requires matching baseline workloads")
    not_repeated = sorted(old_files - after_files)
    missing = (
        "Post-refactor NOT_RUN: "
        + ", ".join(not_repeated)
        + ". Their historical misses remain open."
        if not_repeated
        else "All seven baseline workloads were repeated after the refactor."
    )
    current = sources_match(after)
    source_note = (
        "All after-run SHA256s match current measured editor/worker/core/harness/CSS files."
        if current
        else "After-run digests differ from current source; this evidence is historical and a current-source rerun is required."
    )
    host = (
        f"{after['cpu']}, {after['ramBytes'] / 1073741824:.2f} GiB RAM, {after['os']}, "
        f"Chromium {after['browser']}, Node {after['node']}"
    )
    same_environment = all(
        after["comparison"][field]
        for field in ("sameBrowser", "sameNode", "sameRam", "sameCpu")
    )
    comparison_environment = (
        "Browser, Node, physical RAM and CPU identities match between cohorts."
        if same_environment
        else "Browser/Node/physical RAM/CPU identities differ; consult the raw comparison metadata."
    )
    before_after_note = (
        comparison_environment + " Native input SHA256s "
        "match generated files and HTTP-served bytes, and the first existing warmup independently "
        "checks the browser model's text SHA256/UTF-8 bytes/UTF-16 length/logical lines against the "
        "manifest. This adds no extra timing warmups. One cohort per build does not establish "
        "statistical significance or attribute a delta solely to Next.js. Dense RAM is lower in "
        "the after run, but its workload order differs: the seven-case baseline ran Unicode before "
        "dense; the three-case after run omitted Unicode. Browser allocator reuse and this order "
        "difference prevent a causal RAM optimization claim. Dense steady RAM still misses its target."
    )
    if isolated:
        before_after_note = (
            comparison_environment
            + " Native inputs and browser-model dimensions were independently verified. "
            "The final seven-case study measures memory in a fresh browser per workload, "
            "with its own empty-app process baseline and the same five warmups, thirty "
            "opens, 1000 inputs and thirty subsequent operations. The historical baseline "
            "reused a browser across workloads. This changes the memory cohort: deltas "
            "cannot be attributed causally to an algorithm optimization or Next.js. "
            "The earlier three-case reused-browser comparison remains preserved in "
            "reports/refactor-browser-benchmark.json."
        )
    memory_note = (
        "Steady RAM target is 256 MiB and peak 512 MiB above an empty app. Native Windows "
        "Toolhelp/GetProcessMemoryInfo queries sum browser PID and descendants, including main "
        "process, renderer and dedicated worker. A separate cohort samples three serializations "
        "at a requested 50 ms interval, retaining actual gaps, ancestry, working sets/private commit "
        "and query completeness. All recorded samples in these cohorts are complete. Shared pages "
        "can be counted more than once. Shorter transients can be missed; observed peak is a lower "
        "bound, not a guaranteed maximum. Summed process lifetime peaks are supplemental and not "
        "simultaneous. Reused browsers can retain allocator memory. JS heap is supplemental, not "
        "total browser RAM. Clean per-workload processes and an actual 8 GiB reference host remain unexecuted."
    )
    if isolated:
        memory_note = memory_note.replace(
            "Clean per-workload processes and an actual 8 GiB reference host remain unexecuted.",
            "Fresh per-workload processes were executed with distinct PID/creation identities, "
            "complete native baseline/loaded samples and retained live history/cache/worker buffers. "
            "The actual 8 GiB reference host remains unexecuted.",
        )
    evidence = additional_evidence()
    lines = (
        [
            "# ADR016: measured large-document limits",
            "",
            "Status: Gate D executed with documented limitations. Missed targets remain unmet. "
            "The 8 GiB reference device has not been tested. The Next.js comparison does not waive "
            "misses in workloads that were not rerun. Public contracts and native fixtures are preserved.",
            "",
            "The editor uses persistent CodeMirror text, adaptive uniform/run/dense StyleTree leaves, "
            "lazy transforms, bounded history/cache, viewport decorations, worker ACK/resync, streamed "
            "literal search/replace and native serialization. ADR019 describes the feature/App Router "
            "refactor; it does not change targets in docs/09_TEST_AND_BENCHMARK.md.",
            "",
            "## Historical full baseline",
            "",
            f"Pre-refactor production Vite measured {before['measuredAt']}: seven workloads, seed 42, "
            "five warmups/thirty timing samples per operation/1000 input-to-paint samples per workload. "
            "The immutable archive retains original paths/digests; these historical paths are not "
            "asserted to exist or match migrated code. "
            f"Evidence: [{BASELINE}](../{BASELINE}).",
            "",
        ]
        + table(before["results"])
        + [
            "",
            "Baseline targets met by all seven: " + passing(before["results"]) + ".",
            "",
            "Baseline unmet targets:",
            "",
        ]
        + misses(before["results"])
        + [
            "",
            "## Post-refactor production measurements",
            "",
            f"Measured {after['measuredAt']}, owned production Next.js {after['runtime']['version']} "
            f"webpack build with actual workers: {len(after_files)} workloads, five warmups/thirty timing "
            f"samples per operation/1000 inputs per workload. Status `{after['status']}`. Host: {host}. "
            "Viewport 1500×2100, editor 1400×2000, line height 20 px (100-line viewport). Timing and OS "
            "memory cohorts are separate. Host background services differ between recorded executions; "
            "consult raw evidence and avoid causal claims. The actual 15.63 GiB desktop is not an "
            f"8 GiB reference-device pass. Evidence: [{AFTER}](../{AFTER}).",
            "",
        ]
        + table(after["results"])
        + [
            "",
            "Post-refactor targets met by every repeated case: "
            + passing(after["results"])
            + ".",
            "",
            "Post-refactor unmet targets:",
            "",
        ]
        + misses(after["results"])
        + [
            "",
            "## Before/after scope",
            "",
        ]
        + comparison(before, after)
        + [
            "",
            before_after_note,
            "",
            missing,
            "",
            "Sources unchanged during the after run: yes. " + source_note,
            "",
            "## Memory and latency interpretation",
            "",
            memory_note,
            "",
            "Input timing starts at the editor transaction and ends after paint; hardware/OS keyboard "
            "latency is excluded. Long tasks include warmup/open work and are not relabeled as input "
            "latency. Raw reports retain p50/p95/p99/max, DOM lines/spans, history/worker queue bytes, "
            "JS heap and OS RAM. Single-line/dense workloads stay separate. Edits can split runs; "
            "style-index.json retains original seeded 10k/100k/1m run counts.",
            "",
            "Decision: deliver the local lab with capacity and explicit limitations as Gate D specifies. "
            "The Vietnamese footer warns that large, dense or very long-line files can use substantial "
            "memory, scroll slowly and undo slowly, and offers search/download. Every miss remains open "
            "for profiling. Text/line/history limit violations fail atomically. Full native snapshots "
            "are bounded save/checkpoint operations, not keystroke/render work. Cloud metadata/commit "
            "latency and VM/GKE memory remain unexecuted.",
            "",
            "## Additional evidence and reruns",
            "",
        ]
        + evidence
        + [
            "`npm run benchmark` builds production Next.js, owns/stops its port 5174 server and runs "
            "all seven workloads by default. `npm run worker-check` independently builds/owns its "
            "production server and exercises actual worker/App Router contracts. `BENCH_BASE_URL` may "
            "target an already running production harness. These Windows measurements use the optimized "
            "Next CLI production server; the CLI emits a standalone-output advisory. Docker runs the "
            "standalone server behind the gateway, separately verified by real application E2E. "
            "These browser timings do not measure gateway/network latency. Representative comparison settings:",
            "",
            "```powershell",
            "$env:BENCH_WORKLOADS='ascii-long-line-10MiB.tedoc,million-lines.tedoc,dense-10MiB.tedoc'",
            "$env:BENCH_REPORT_FILE='reports/refactor-browser-benchmark.json'",
            "$env:BENCH_BASELINE_FILE='reports/refactor-baseline/browser-benchmark.json'",
            "npm run benchmark",
            "Remove-Item Env:BENCH_WORKLOADS,Env:BENCH_REPORT_FILE,Env:BENCH_BASELINE_FILE",
            "python -X utf8 checks/write_performance_report.py",
            "```",
            "",
            "Linux shells can set the same environment values. Timings are portable; the native OS "
            "RAM sampler currently requires Windows. Linux memory targets need an equivalent sampler "
            "before a pass is claimed. The generator rejects quick/incomplete/malformed cohorts, "
            "verifies identities and reports source equivalence without testing deleted Vite paths. "
            "Other gates are read as they exist, never promoted from historical evidence.",
            "",
            f"Artifact SHA256s at generation: baseline `{digest(BASELINE)}`, after `{digest(AFTER)}`. "
            "The raw reports retain measured source digests and samples.",
        ]
    )
    (ROOT / "docs/11_PERFORMANCE_ACCEPTANCE.md").write_text(
        "\n".join(lines) + "\n", encoding="utf-8"
    )

    node = shutil.which("node")
    prettier = ROOT / "node_modules/prettier/bin/prettier.cjs"
    require(
        node and prettier.is_file(),
        "Install documented Node/npm prerequisites to format generated evidence",
    )
    subprocess.run(
        [
            node,
            str(prettier),
            "--write",
            "--ignore-path",
            ".gitignore",
            "docs/11_PERFORMANCE_ACCEPTANCE.md",
        ],
        cwd=ROOT,
        check=True,
    )
    print(
        f"Wrote ADR016 performance evidence: historical 7 / after {len(after_files)}; "
        f"current measured sources {'match' if current else 'STALE, rerun required'}; misses retained"
    )


if __name__ == "__main__":
    main()
