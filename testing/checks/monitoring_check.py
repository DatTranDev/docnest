"""Check actual PromQL and alert behavior using checksum-pinned official promtool."""

import argparse
import hashlib
import io
from pathlib import Path
import platform
import subprocess
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
VERSION = "3.15.0"
ASSETS = {
    "Windows": (
        "windows-amd64.zip",
        "5d333b385557d9adc2ff015d13da9809baccc52fb800a82d1e5c94b79258f87e",
        "promtool.exe",
    ),
    "Linux": (
        "linux-amd64.tar.gz",
        "2a542df32eac02ee17b9d844fb2aa1de00dafa5476579ba8a3ba862e9d572ea0",
        "promtool",
    ),
}


def install():
    if platform.machine() not in ("AMD64", "x86_64") or platform.system() not in ASSETS:
        raise ValueError("Pinned monitoring validator supports Linux/Windows amd64")
    suffix, expected, executable = ASSETS[platform.system()]
    target = ROOT / ".tools/prometheus" / VERSION / executable
    name = f"prometheus-{VERSION}.{suffix}"
    with urllib.request.urlopen(
        f"https://github.com/prometheus/prometheus/releases/download/v{VERSION}/"
        + name,
        timeout=60,
    ) as response:
        data = response.read(128 * 1024**2 + 1)
    if len(data) > 128 * 1024**2 or hashlib.sha256(data).hexdigest() != expected:
        raise ValueError("Official promtool archive checksum mismatch")
    member = (
        f"prometheus-{VERSION}."
        + suffix.split(".tar")[0].removesuffix(".zip")
        + "/"
        + executable
    )
    if suffix.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(data)) as bundle:
            payload = bundle.read(member)
    else:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as bundle:
            entry = bundle.getmember(member)
            if not entry.isfile():
                raise ValueError("Promtool executable archive member rejected")
            payload = bundle.extractfile(entry).read()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(payload)
    target.chmod(0o755)
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--promtool", type=Path)
    args = parser.parse_args()
    tool = args.promtool or (
        install()
        if args.download
        else ROOT
        / f".tools/prometheus/{VERSION}"
        / ("promtool.exe" if platform.system() == "Windows" else "promtool")
    )
    directory = ROOT / "infra/monitoring"
    for command in (
        ["check", "rules", "docsnest-alerts.yml"],
        ["test", "rules", "docsnest-alerts.test.yml"],
    ):
        subprocess.run([str(tool), *command], cwd=directory, check=True)


if __name__ == "__main__":
    main()
