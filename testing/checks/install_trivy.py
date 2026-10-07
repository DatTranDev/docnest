#!/usr/bin/env python3
"""Install a pinned official Trivy release after verifying its SHA-256 checksum.

Uses public HTTPS downloads only; no account, registry login, or cloud resource.
The official checksum and GitHub asset digest are provenance checks; this helper
does not claim to verify a Sigstore publisher signature.
"""

import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
VERSION = "0.75.0"
DESTINATION = ROOT / ".tools/trivy"


def download(url, path):
    print(f"Download {url}", flush=True)
    request = urllib.request.Request(
        url, headers={"User-Agent": "text-editor-local-security-check"}
    )
    with (
        urllib.request.urlopen(request, timeout=90) as response,
        path.open("wb") as target,
    ):
        shutil.copyfileobj(response, target)


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main():
    system = platform.system()
    machine = platform.machine().lower()
    if system == "Windows" and machine in {"amd64", "x86_64"}:
        suffix, executable = "windows-64bit.zip", "trivy.exe"
    elif system in {"Linux", "Darwin"} and machine in {
        "amd64",
        "x86_64",
        "aarch64",
        "arm64",
    }:
        architecture = "ARM64" if machine in {"aarch64", "arm64"} else "64bit"
        suffix = f"{'macOS' if system == 'Darwin' else system}-{architecture}.tar.gz"
        executable = "trivy"
    else:
        raise SystemExit(
            f"Unsupported installer host {system}/{machine}; use a separately verified official binary."
        )
    DESTINATION.mkdir(parents=True, exist_ok=True)
    source = f"https://github.com/aquasecurity/trivy/releases/download/v{VERSION}"
    asset_name = f"trivy_{VERSION}_{suffix}"
    archive = DESTINATION / ("trivy.zip" if suffix.endswith(".zip") else "trivy.tar.gz")
    checksums = DESTINATION / "checksums.txt"
    release = DESTINATION / "release.json"
    # Cached archives are re-hashed before any binary is extracted or executed.
    if not release.exists():
        download(
            f"https://api.github.com/repos/aquasecurity/trivy/releases/tags/v{VERSION}",
            release,
        )
    if not checksums.exists():
        download(f"{source}/trivy_{VERSION}_checksums.txt", checksums)
    if not archive.exists():
        download(f"{source}/{asset_name}", archive)
    release_metadata = json.loads(release.read_text(encoding="utf-8-sig"))
    if release_metadata.get("tag_name") != f"v{VERSION}":
        raise SystemExit("Release metadata version mismatch; installation aborted.")
    expected = next(
        (
            line.split()[0]
            for line in checksums.read_text(encoding="utf-8-sig").splitlines()
            if len(line.split()) == 2 and line.split()[1].lstrip("*") == asset_name
        ),
        None,
    )
    actual = sha256(archive)
    if not expected or actual != expected:
        raise SystemExit(
            "Official SHA-256 checksum mismatch; installation aborted without extracting or executing."
        )
    asset = next(
        (item for item in release_metadata["assets"] if item["name"] == asset_name),
        None,
    )
    asset_digest = asset.get("digest") if asset else None
    if asset_digest and asset_digest != f"sha256:{actual}":
        raise SystemExit("GitHub release asset digest mismatch; installation aborted.")
    binary = DESTINATION / "bin" / executable
    binary.parent.mkdir(exist_ok=True)
    # Extract only the verified executable, never archive-selected filesystem paths.
    if suffix.endswith(".zip"):
        with zipfile.ZipFile(archive) as zipped:
            members = [
                name for name in zipped.namelist() if Path(name).name == executable
            ]
            if len(members) != 1:
                raise SystemExit("Expected one Trivy executable in official archive.")
            with zipped.open(members[0]) as stream, binary.open("wb") as output:
                shutil.copyfileobj(stream, output)
    else:
        with tarfile.open(archive, "r:gz") as packed:
            members = [
                member
                for member in packed.getmembers()
                if member.isfile() and Path(member.name).name == executable
            ]
            if len(members) != 1:
                raise SystemExit("Expected one Trivy executable in official archive.")
            with packed.extractfile(members[0]) as stream, binary.open("wb") as output:
                shutil.copyfileobj(stream, output)
        binary.chmod(binary.stat().st_mode | 0o111)
    verification = {
        "version": f"v{VERSION}",
        "publishedAt": release_metadata["published_at"],
        "archiveSource": f"{source}/{asset_name}",
        "checksumsSource": f"{source}/trivy_{VERSION}_checksums.txt",
        "expectedSha256": expected,
        "actualSha256": actual,
        "githubAssetDigest": asset_digest,
        "checksumVerified": True,
        "binarySha256": sha256(binary),
        "publisherSignatureVerified": False,
    }
    (DESTINATION / "verification.json").write_text(
        json.dumps(verification, indent=2) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "binary": str(binary),
                "archiveChecksumVerified": True,
                "binarySha256": verification["binarySha256"],
                "publisherSignatureVerified": False,
            }
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
