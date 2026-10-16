"""Scoped build provenance and reviewed six-image environment state validation."""

import copy
import hashlib
import json
import re
from pathlib import Path

from detect_affected import selection
from digest_manifest import validate_manifest


def validate_provenance(provenance, images, repository):
    if not isinstance(provenance, dict) or set(provenance) != set(images):
        raise ValueError("Every image requires its own provenance")
    for name, image in images.items():
        record = provenance[name]
        scan = record.get("scan", {})
        if (
            record.get("image") != image
            or not re.fullmatch(r"[a-f0-9]{40}", record.get("commit", ""))
            or not re.fullmatch(
                re.escape(repository) + r"/actions/runs/[0-9]+",
                record.get("runUrl", ""),
            )
            or scan.get("highCriticalGate") != "PASS"
            or scan.get("secretGate") != "PASS"
            or not re.fullmatch(r"[a-f0-9]{64}", scan.get("evidenceSha256", ""))
            or not re.fullmatch(r"sha256:[a-f0-9]{64}", scan.get("imageId", ""))
        ):
            raise ValueError("Invalid image provenance: " + name)


def scan_records(names):
    names = selection(names, allow_empty=False)
    paths = [
        Path("testing/reports/image-secrets.json"),
        Path("testing/reports/image-os-scan.json"),
    ]
    secret, os_scan = [json.loads(path.read_text(encoding="utf-8")) for path in paths]
    secrets = {record["image"]: record for record in secret.get("images", [])}
    scans = {record["reference"]: record for record in os_scan.get("scans", [])}
    expected = {f"text-editor/{name}:local" for name in names}
    if (
        secret.get("status") != "PASS"
        or os_scan.get("highCriticalGate") != "PASS"
        or set(secrets) != expected
        or set(scans) != expected
        or set(os_scan.get("requiredImages", [])) != expected
        or os_scan.get("pendingImages") != []
    ):
        raise ValueError("Incomplete or failed exact-selection image scans")
    digest = hashlib.sha256(b"\n".join(path.read_bytes() for path in paths)).hexdigest()
    result = {}
    for name in names:
        ref = f"text-editor/{name}:local"
        record = scans[ref]
        if record.get("highCriticalGate") != "PASS" or record.get("imageId") != secrets[
            ref
        ].get("imageId"):
            raise ValueError("Scanners did not inspect the same image")
        result[name] = {
            "imageId": record["imageId"],
            "evidenceSha256": digest,
            "highCriticalGate": "PASS",
            "secretGate": "PASS",
        }
    return result


def merge_state(state, build, *, project, region, repository, commit, run_url):
    previous = state.get("images", {})
    changed = build.get("images", {})
    validate_manifest(previous, project, region)
    if changed:
        validate_manifest(changed, project, region, partial=True)
    for manifest, images in ((state, previous), (build, changed)):
        if (
            manifest.get("schemaVersion") != 2
            or manifest.get("nativeFormatVersion") != 6
        ):
            raise ValueError("Reviewed V2 release provenance and native V6 required")
        if manifest.get("environment") != "cloud-gke":
            raise ValueError("Release environment is not authorized")
        if manifest.get("ref") != "refs/heads/main":
            raise ValueError("Only protected main releases may be deployed")
        validate_provenance(manifest.get("imageProvenance"), images, repository)
    if (
        build.get("commit") != commit
        or build.get("runUrl") != run_url
        or state.get("googleClientId") != build.get("googleClientId")
        or not re.fullmatch(r"[a-f0-9]{40}", state.get("commit", ""))
        or any(
            record["commit"] != commit or record["runUrl"] != run_url
            for record in build["imageProvenance"].values()
        )
    ):
        raise ValueError(
            "Changed images must have same-run provenance; client changes require coordinated release"
        )
    merged = copy.deepcopy(build)
    merged["images"] = {**previous, **changed}
    merged["imageProvenance"] = {**state["imageProvenance"], **build["imageProvenance"]}
    merged["previousImages"] = previous
    merged["selectedServices"] = selection(list(changed))
    return merged
