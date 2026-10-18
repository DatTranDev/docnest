"""Build, scan and publish an allowlisted image selection; no deployment or provisioning."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time

from detect_affected import selection
from digest_manifest import validate_manifest
from release_manifest import scan_records

STAGE_LOCK = threading.Lock()
PUBLISH_WORKERS = 3


def run(*args, capture=False):
    started = time.monotonic()
    exit_code = -1
    try:
        result = subprocess.run(
            list(args), check=True, capture_output=capture, text=True
        )
        exit_code = result.returncode
        return result.stdout.strip() if capture else None
    except subprocess.CalledProcessError as error:
        exit_code = error.returncode
        raise
    finally:
        target = Path("testing/reports/cloud-build-stages.json")
        target.parent.mkdir(parents=True, exist_ok=True)
        # Only allowlisted scalar labels, never raw command arguments or output.
        services = [
            name
            for name in selection(json.loads(os.environ["BUILD_SERVICES"]))
            if any(
                value == f"text-editor/{name}:local" or f"/{name}:" in value
                for value in args
            )
        ]
        record = {
            "action": os.environ["CLOUD_BUILD_ACTION"],
            "tool": Path(args[0]).name,
            "services": services,
            "durationSeconds": round(time.monotonic() - started, 2),
            "exitCode": exit_code,
        }
        with STAGE_LOCK:
            records = (
                json.loads(target.read_text(encoding="utf-8"))
                if target.exists()
                else []
            )
            records.append(record)
            target.write_text(json.dumps(records, indent=2) + "\n", encoding="utf-8")


def publish_image(name, registry):
    tag = f"{registry}/{name}:{os.environ['GITHUB_SHA']}"
    run("docker", "push", tag)
    refs = json.loads(
        run("docker", "inspect", "--format", "{{json .RepoDigests}}", tag, capture=True)
    )
    candidates = [ref for ref in refs if ref.startswith(f"{registry}/{name}@sha256:")]
    if len(candidates) != 1:
        raise ValueError("Published image has an ambiguous immutable digest")
    return name, candidates[0]


def build(names, registry):
    backends = [name for name in names if name != "web"]
    old = Path("/tmp/cloud-build-cache")
    new = Path("/tmp/cloud-build-cache-new")
    new.mkdir(parents=True, exist_ok=True)
    if backends:
        modules = "MAVEN_PROJECTS=" + ",".join("backend/" + name for name in backends)
        common = [
            "docker",
            "buildx",
            "build",
            "-f",
            "infra/compose/Service.Dockerfile",
            "--build-arg",
            "SECURITY_REFRESH="
            + os.environ["GITHUB_RUN_ID"]
            + "-"
            + os.environ["GITHUB_RUN_ATTEMPT"],
        ]
        run(
            *common,
            "--target",
            "build-all",
            "--build-arg",
            modules,
            "--cache-from",
            f"type=local,src={old}/backend",
            "--cache-to",
            f"type=local,dest={new}/backend,mode=max",
            ".",
        )
        run(*common, "--target", "runtime", "--no-cache-filter", "runtime", ".")
        for name in backends:
            run(
                *common,
                "--target",
                "cloud",
                "--build-arg",
                modules,
                "--build-arg",
                "SERVICE=" + name,
                "--load",
                "-t",
                f"text-editor/{name}:local",
                "-t",
                f"{registry}/{name}:{os.environ['GITHUB_SHA']}",
                ".",
            )
    if "web" in names:
        run(
            "docker",
            "buildx",
            "build",
            "--load",
            "-f",
            "infra/compose/Web.Dockerfile",
            "--no-cache-filter",
            "runtime",
            "--cache-from",
            f"type=local,src={old}/web",
            "--cache-to",
            f"type=local,dest={new}/web,mode=max",
            "--build-arg",
            "NEXT_PUBLIC_GOOGLE_CLIENT_ID=" + os.environ.get("GOOGLE_CLIENT_ID", ""),
            "-t",
            "text-editor/web:local",
            "-t",
            f"{registry}/web:{os.environ['GITHUB_SHA']}",
            ".",
        )
    # Keep the other family cache during a one-family release; replace old exports.
    old.mkdir(parents=True, exist_ok=True)
    for child in new.iterdir():
        target = old / child.name
        if (
            child.name not in ("backend", "web")
            or child.is_symlink()
            or not target.resolve().is_relative_to(old.resolve())
        ):
            raise ValueError("Build cache path escaped its fixed cache directory")
        if target.exists():
            shutil.rmtree(target)
        shutil.move(str(child), str(target))
    new.rmdir()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["build", "scan", "publish", "record"])
    args = parser.parse_args()
    os.environ["CLOUD_BUILD_ACTION"] = args.action
    names = selection(json.loads(os.environ["BUILD_SERVICES"]), allow_empty=False)
    project, region = os.environ["GCP_PROJECT"], os.environ["GCP_REGION"]
    registry = f"{region}-docker.pkg.dev/{project}/editor"
    validate_manifest(
        {name: f"{registry}/{name}@sha256:" + "a" * 64 for name in names},
        project,
        region,
        partial=True,
    )
    if args.action == "build":
        build(names, registry)
    elif args.action == "scan":
        run(sys.executable, "testing/checks/image_secrets.py", "--services", *names)
        run(sys.executable, "testing/checks/install_trivy.py")
        refs = [f"text-editor/{name}:local" for name in names]
        run(
            sys.executable,
            "testing/checks/image_os_scan.py",
            "--download-db",
            "--images",
            *refs,
            "--required-images",
            *refs,
        )
        scan_records(names)
    elif args.action == "publish":
        scans = scan_records(names)
        # Validate the complete selection before any parallel registry write.
        for name in names:
            tag = f"{registry}/{name}:{os.environ['GITHUB_SHA']}"
            actual = run("docker", "inspect", "--format", "{{.Id}}", tag, capture=True)
            if actual != scans[name]["imageId"]:
                raise ValueError("Publish image differs from scanned image")
        with ThreadPoolExecutor(max_workers=min(PUBLISH_WORKERS, len(names))) as pool:
            images = dict(pool.map(lambda name: publish_image(name, registry), names))
        validate_manifest(images, project, region, partial=True)
        Path("image-digests.json").write_text(
            json.dumps(images, indent=2) + "\n", encoding="utf-8"
        )
        Path("image-digests.txt").write_text(
            "\n".join(images.values()) + "\n", encoding="utf-8"
        )
    else:
        images = json.loads(Path("image-digests.json").read_text(encoding="utf-8"))
        validate_manifest(images, project, region, partial=True)
        if set(images) != set(names):
            raise ValueError("Published selection differs from requested selection")
        scans = scan_records(names)
        run_url = os.environ["RUN_URL"]
        release = {
            "schemaVersion": 2,
            "environment": "cloud-gke",
            "commit": os.environ["GITHUB_SHA"],
            "ref": os.environ["GITHUB_REF"],
            "runUrl": run_url,
            "images": images,
            "googleClientId": os.environ.get("GOOGLE_CLIENT_ID", ""),
            "nativeFormatVersion": 6,
            "imageProvenance": {
                name: {
                    "image": images[name],
                    "commit": os.environ["GITHUB_SHA"],
                    "runUrl": run_url,
                    "scan": scans[name],
                }
                for name in names
            },
        }
        Path("cloud-release.json").write_text(
            json.dumps(release, indent=2) + "\n", encoding="utf-8"
        )
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            output.write(
                "image_digests=" + json.dumps(images, separators=(",", ":")) + "\n"
            )
            output.write(
                "release_json=" + json.dumps(release, separators=(",", ":")) + "\n"
            )
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as output:
            output.write(
                "Published scanned immutable images: "
                + ", ".join(names)
                + ". Per-service provenance: cloud-image-digests artifact.\n"
            )


if __name__ == "__main__":
    main()
