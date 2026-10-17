"""Before publishing changed migration owners, test real old/new images on new schemas."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tooling/scripts"))
from detect_affected import selection
from digest_manifest import NAMES, validate_manifest
from release_manifest import validate_provenance


def owners(plan, built):
    selected = selection(plan["impact"]["migrations"])
    if "web" in selected or not set(selected).issubset(built):
        raise ValueError("Migration owners must match actual selected backend images")
    return selected


def run(command):
    result = subprocess.run(command, capture_output=True, timeout=1000)
    if result.returncode:
        raise ValueError(
            "Old/new schema compatibility failed; protected output withheld"
        )


def main():
    plan = json.loads(os.environ["RELEASE_PLAN"])
    built = selection(json.loads(os.environ["BUILD_SERVICES"]), allow_empty=False)
    changed = owners(plan, built)
    destination = ROOT / "testing/reports/mixed-version-gate.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    baseline = plan["baseline"]
    report = {
        "scope": "Actual old/new images on candidate schemas; representative DDL/backfill and event compatibility need separate review",
        "owners": changed,
    }
    if not changed or baseline is None:
        report.update(
            status="NOT_APPLICABLE",
            reason=(
                "No migration"
                if not changed
                else "First adoption has no approved previous-image provenance; fresh-schema acceptance is separate"
            ),
        )
        destination.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        return
    repository = os.environ["GITHUB_SERVER_URL"] + "/" + os.environ["GITHUB_REPOSITORY"]
    validate_manifest(
        baseline["images"], os.environ["GCP_PROJECT"], os.environ["GCP_REGION"]
    )
    validate_provenance(baseline["imageProvenance"], baseline["images"], repository)
    for name in NAMES:
        run(["docker", "pull", baseline["images"][name]])
    references = {
        **baseline["images"],
        **{name: "text-editor/" + name + ":local" for name in built},
    }
    images = destination.with_name("mixed-candidate-images.json")
    images.write_text(json.dumps(references), encoding="utf-8")
    report["checks"] = []
    for name in changed:
        output = destination.with_name("mixed-schema-" + name + ".json")
        run(
            [
                sys.executable,
                str(ROOT / "tooling/scripts/mixed_version_check.py"),
                "--service",
                name,
                "--old-image",
                baseline["images"][name],
                "--new-image",
                references[name],
                "--images",
                str(images),
                "--report",
                str(output),
            ]
        )
        result = json.loads(output.read_text(encoding="utf-8"))
        if result.get("status") != "PASS" or result.get("schemaCompatible") is not True:
            raise ValueError("Mixed schema evidence is missing or failed")
        report["checks"].append(
            {
                "service": name,
                "reportSha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                "oldImage": baseline["images"][name],
                "newImageId": result["resolvedNewImages"][name],
            }
        )
    report["status"] = "PASS"
    destination.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
