#!/usr/bin/env python3
"""Anonymous Trivy OS-image scan; local immutable image IDs, one scanner worker.

Prerequisite: Trivy 0.75.0 from the official GitHub release, verified against the
official checksums, available via --trivy or .tools/trivy/bin/trivy.exe. This
script never logs in, uploads an image, creates an account, or provisions cloud
resources. --download-db retrieves the public vulnerability database only.
"""

import argparse
import collections
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_IMAGES = [
    f"text-editor/{service}:local"
    for service in ["identity-service", "document-service", "processing-service", "web"]
]


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def invoke(command, log, timeout=420):
    start = utc_now()
    print("+ " + " ".join(str(part) for part in command), flush=True)
    try:
        process = subprocess.run(
            command,
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
        output = process.stdout + process.stderr
        log.write_text(output, encoding="utf-8")
        return {
            "command": [str(part) for part in command],
            "startedAt": start,
            "endedAt": utc_now(),
            "exitCode": process.returncode,
            "log": str(log.relative_to(ROOT)),
        }, process.stdout
    except (subprocess.TimeoutExpired, OSError) as error:
        log.write_text(str(error), encoding="utf-8")
        return {
            "command": [str(part) for part in command],
            "startedAt": start,
            "endedAt": utc_now(),
            "exitCode": None,
            "log": str(log.relative_to(ROOT)),
            "error": str(error),
        }, ""


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig")) if path.is_file() else None


def summarize(report):
    completed = {
        scan["reference"] for scan in report["scans"] if scan["status"] != "BLOCKED"
    }
    report["requiredImages"] = DEFAULT_IMAGES
    report["pendingImages"] = [
        image for image in DEFAULT_IMAGES if image not in completed
    ]
    blocked = any(scan["status"] == "BLOCKED" for scan in report["scans"])
    report["status"] = (
        "BLOCKED"
        if blocked
        else (
            "PENDING"
            if report["pendingImages"]
            else (
                "SCANNED_WITH_FINDINGS"
                if any(scan.get("findings") for scan in report["scans"])
                else "PASS"
            )
        )
    )
    report["highCriticalGate"] = (
        "UNVERIFIED"
        if blocked or report["pendingImages"]
        else (
            "FAIL"
            if any(scan.get("highCriticalGate") == "FAIL" for scan in report["scans"])
            else "PASS"
        )
    )
    all_findings = [
        finding for scan in report["scans"] for finding in scan.get("findings", [])
    ]
    report["severityCountsAcrossImages"] = dict(
        collections.Counter(finding["Severity"] for finding in all_findings)
    )
    report["uniqueCveCount"] = len(
        {finding["VulnerabilityID"] for finding in all_findings}
    )
    report["fixableFindingsAcrossImages"] = sum(
        bool(finding.get("FixedVersion")) for finding in all_findings
    )
    report["countingNote"] = (
        "Severity totals count CVE/package/image combinations. Shared runtime packages repeat across the three Java images; uniqueCveCount deduplicates CVE IDs."
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    cached_binary = (
        ROOT / ".tools/trivy/bin" / ("trivy.exe" if os.name == "nt" else "trivy")
    )
    parser.add_argument(
        "--trivy",
        default=os.environ.get(
            "TRIVY_PATH",
            (
                str(cached_binary)
                if cached_binary.exists()
                else shutil.which("trivy") or "trivy"
            ),
        ),
    )
    parser.add_argument("--images", nargs="+", default=DEFAULT_IMAGES)
    parser.add_argument("--download-db", action="store_true")
    parser.add_argument("--append", action="store_true")
    args = parser.parse_args()
    destination = ROOT / "reports/image-os"
    destination.mkdir(parents=True, exist_ok=True)
    cache = ROOT / ".tools/trivy/cache"
    cache.mkdir(parents=True, exist_ok=True)
    report_path = ROOT / "reports/image-os-scan.json"
    report = read_json(report_path) if args.append else None
    if not report:
        report = {
            "startedAt": utc_now(),
            "scope": "OS packages in the four locally built Linux application images only",
            "exclusions": [
                "Java/JavaScript dependency advisories",
                "Secrets and IaC",
                "Exploitability and runtime penetration testing",
                "MySQL, Redis, Kafka, and other infrastructure images",
            ],
            "scanner": {
                "tool": "Trivy",
                "release": "0.75.0",
                "releaseSource": "https://github.com/aquasecurity/trivy/releases/tag/v0.75.0",
                "databaseDocs": "https://trivy.dev/docs/latest/configuration/db/",
                "binaryVerification": read_json(
                    ROOT / ".tools/trivy/verification.json"
                ),
            },
            "database": {},
            "scans": [],
        }
    verification = read_json(ROOT / ".tools/trivy/verification.json")
    if (
        Path(args.trivy).resolve() == cached_binary.resolve()
        and cached_binary.exists()
        and verification
    ):
        with cached_binary.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        report["scanner"]["binaryVerification"] = verification
        report["scanner"]["executedBinarySha256"] = digest
        if digest != verification.get("binarySha256"):
            report.update(
                status="BLOCKED",
                blocker="Cached executable hash differs from verified installer evidence; scanner not executed.",
                completedAt=utc_now(),
            )
            report_path.write_text(
                json.dumps(report, indent=2) + "\n", encoding="utf-8"
            )
            return 2
    else:
        report["scanner"]["binaryVerification"] = None
        report["scanner"][
            "binaryVerificationNote"
        ] = "Custom executable provenance was not verified by this helper."
    version_command, version_text = invoke(
        [args.trivy, "--version"], destination / "version.log", 30
    )
    report["scanner"]["versionCommand"] = version_command
    report["scanner"]["versionOutput"] = version_text.strip()
    if version_command["exitCode"] != 0:
        report["status"] = "BLOCKED"
        report["blocker"] = "Verified Trivy binary unavailable; no image scan executed."
        report["completedAt"] = utc_now()
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        return 2
    if args.download_db:
        download_command, _ = invoke(
            [
                args.trivy,
                "image",
                "--cache-dir",
                str(cache),
                "--db-repository",
                "ghcr.io/aquasecurity/trivy-db:2",
                "--download-db-only",
                "--parallel",
                "1",
                "--timeout",
                "3m",
            ],
            destination / "db-download.log",
            210,
        )
        report["database"]["downloadCommand"] = download_command
    metadata = read_json(cache / "db/metadata.json")
    report["database"]["metadata"] = metadata
    report["database"]["officialRepository"] = "ghcr.io/aquasecurity/trivy-db:2"
    report["database"][
        "integrityScope"
    ] = "Trivy OCI downloader verifies content-addressed blobs; DB publisher signature was not separately verified."
    if not metadata:
        report["status"] = "BLOCKED"
        report["blocker"] = (
            "No vulnerability DB cached after anonymous download; no image scan executed."
        )
        report["completedAt"] = utc_now()
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        return 2
    for reference in args.images:
        name = (
            reference.removeprefix("text-editor/").replace(":", "-").replace("/", "-")
        )
        inspect_command, inspected = invoke(
            ["docker", "image", "inspect", reference],
            destination / f"{name}-inspect.log",
            30,
        )
        # Do not retain complete Docker inspect output: image metadata can contain
        # environment values in an arbitrary user-selected image.
        if inspect_command["exitCode"] == 0:
            (destination / f"{name}-inspect.log").write_text(
                "Docker inspect executed; selected non-secret identity fields are in summary JSON.\n",
                encoding="utf-8",
            )
        if inspect_command["exitCode"] != 0:
            record = {
                "reference": reference,
                "status": "BLOCKED",
                "inspectCommand": inspect_command,
                "blocker": "Local image unavailable; scan not executed.",
            }
        else:
            image = json.loads(inspected)[0]
            image_id = image["Id"]
            output = destination / f"{name}-trivy.json"
            command = [
                args.trivy,
                "image",
                "--cache-dir",
                str(cache),
                "--image-src",
                "docker",
                "--scanners",
                "vuln",
                "--pkg-types",
                "os",
                "--parallel",
                "1",
                "--offline-scan",
                "--skip-db-update",
                "--skip-java-db-update",
                "--format",
                "json",
                "--list-all-pkgs",
                "--timeout",
                "5m",
                "--output",
                str(output),
                image_id,
            ]
            execution, _ = invoke(command, destination / f"{name}-scan.log", 330)
            raw = read_json(output) if execution["exitCode"] == 0 else None
            record = {
                "reference": reference,
                "imageId": image_id,
                "createdAt": image.get("Created"),
                "architecture": image.get("Architecture"),
                "os": image.get("Os"),
                "execution": execution,
                "rawResult": str(output.relative_to(ROOT)),
            }
            if not raw:
                record.update(
                    status="BLOCKED",
                    blocker="Trivy did not complete the OS scan; see exact scanner log.",
                )
            else:
                findings = []
                package_counts = []
                for result in raw.get("Results", []):
                    if result.get("Class") != "os-pkgs":
                        continue
                    package_counts.append(
                        {
                            "target": result.get("Target"),
                            "type": result.get("Type"),
                            "packageCount": len(result.get("Packages", [])),
                        }
                    )
                    for vulnerability in result.get("Vulnerabilities", []):
                        findings.append(
                            {
                                field: vulnerability.get(field)
                                for field in [
                                    "VulnerabilityID",
                                    "PkgName",
                                    "InstalledVersion",
                                    "FixedVersion",
                                    "Severity",
                                    "Status",
                                    "PrimaryURL",
                                    "Title",
                                    "PublishedDate",
                                    "LastModifiedDate",
                                    "DataSource",
                                ]
                            }
                        )
                severity = dict(
                    collections.Counter(finding["Severity"] for finding in findings)
                )
                record.update(
                    status="SCANNED_WITH_FINDINGS" if findings else "PASS",
                    metadata={
                        key: raw.get("Metadata", {}).get(key)
                        for key in ["OS", "Size", "ImageID", "DiffIDs"]
                    },
                    severityCounts=severity,
                    packages=package_counts,
                    findings=findings,
                    uniqueCveCount=len(
                        {finding["VulnerabilityID"] for finding in findings}
                    ),
                    fixableFindings=[
                        finding for finding in findings if finding.get("FixedVersion")
                    ],
                    highCriticalGate=(
                        "FAIL"
                        if severity.get("HIGH", 0) + severity.get("CRITICAL", 0)
                        else "PASS"
                    ),
                )
                if not package_counts:
                    record.update(
                        status="BLOCKED",
                        highCriticalGate="UNVERIFIED",
                        blocker="Scanner returned no OS-package result; coverage is unverified.",
                    )
                print(
                    json.dumps(
                        {
                            "reference": reference,
                            "imageId": image_id,
                            "status": record["status"],
                            "severityCounts": severity,
                            "packages": package_counts,
                        }
                    ),
                    flush=True,
                )
        report["scans"] = [
            scan for scan in report["scans"] if scan["reference"] != reference
        ] + [record]
        report["completedAt"] = utc_now()
        summarize(report)
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return (
        2
        if report["status"] == "BLOCKED"
        else 1 if report["highCriticalGate"] == "FAIL" else 0
    )


if __name__ == "__main__":
    sys.exit(main())
