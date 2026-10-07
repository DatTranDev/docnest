"""Inspect built image configuration and first-party payloads, never runtime volumes."""

import datetime
import io
import json
import pathlib
import re
import secrets
import subprocess
import sys
import tempfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tooling/scripts"))
from run import initialize

SERVICES = ("identity-service", "document-service", "processing-service", "web")
PRIVATE_PEM = re.compile(rb"-----BEGIN (?:RSA )?PRIVATE KEY-----\s+[A-Za-z0-9+/]{40}")


def docker(*arguments):
    return subprocess.run(
        ["docker", *arguments], capture_output=True, check=True
    ).stdout


def first_party_payloads(path, service):
    if service == "web":
        for source in path.rglob("*"):
            if source.is_file():
                yield source.read_bytes()
        return
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            assert not name.endswith(
                "/NativeBenchmark.class"
            ), "Benchmark harness must not enter runtime JAR"
            if name.startswith("BOOT-INF/lib/editor-common-") and name.endswith(".jar"):
                with zipfile.ZipFile(io.BytesIO(archive.read(name))) as common:
                    for common_name in common.namelist():
                        assert not common_name.endswith(
                            "/NativeBenchmark.class"
                        ), "Shared benchmark harness must not enter runtime JAR"
                        if not common_name.endswith("/"):
                            yield common.read(common_name)
            if not name.endswith("/") and not name.startswith("BOOT-INF/lib/"):
                yield archive.read(name)


def main():
    values = initialize()
    needles = [
        value.encode()
        for key, value in values.items()
        if key.endswith(("PASSWORD", "KEY")) and len(value) > 20
    ]
    scratch = ROOT / ".tools" / "image-scan"
    scratch.mkdir(parents=True, exist_ok=True)
    assert scratch.resolve().is_relative_to(
        ROOT.resolve()
    ), "Image scan scratch escaped workspace"
    checks = []
    for service in SERVICES:
        image = f"text-editor/{service}:local"
        metadata = json.loads(docker("image", "inspect", image))[0]
        assert metadata["Config"]["User"] not in ("", "0", "root", "0:0"), (
            image + " must be nonroot"
        )
        configuration = json.dumps(metadata["Config"]).encode()
        assert not any(value in configuration for value in needles), (
            image + " contains generated credentials in image configuration"
        )
        assert not PRIVATE_PEM.search(configuration), (
            image + " contains a private PEM in image configuration"
        )
        container = "editor-image-check-" + secrets.token_hex(4)
        docker("create", "--name", container, image)
        try:
            # A fresh destination prevents docker cp nesting and stale files from
            # earlier images from contaminating a repeated scan. This temporary
            # tree is created and removed only inside the known workspace scratch.
            with tempfile.TemporaryDirectory(
                prefix=service + "-", dir=scratch
            ) as temporary:
                destination = pathlib.Path(temporary) / "payload"
                assert destination.resolve().is_relative_to(scratch.resolve())
                source = "/app/frontend/web" if service == "web" else "/app/app.jar"
                docker("cp", container + ":" + source, str(destination))
                assert destination.exists(), image + " has no application payload"
                payload_count = 0
                for payload in first_party_payloads(destination, service):
                    payload_count += 1
                    assert not any(value in payload for value in needles), (
                        image + " contains generated local credentials"
                    )
                    assert not PRIVATE_PEM.search(payload), (
                        image + " contains a private PEM payload"
                    )
                assert payload_count, image + " has no inspectable first-party files"
                checks.append(
                    {
                        "image": image,
                        "imageId": metadata["Id"],
                        "payloadCount": payload_count,
                        "nonRoot": True,
                        "generatedCredentialsAbsent": True,
                        "privatePemPayloadAbsent": True,
                        **(
                            {"benchmarkHarnessAbsent": True} if service != "web" else {}
                        ),
                    }
                )
        finally:
            docker("rm", container)
    report = {
        "status": "PASS",
        "completedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "scope": "image config and first-party application payloads including editor-common; no mounted runtime data or third-party libraries; OS CVEs scanned separately",
        "images": checks,
    }
    (ROOT / "testing/reports").mkdir(parents=True, exist_ok=True)
    (ROOT / "testing/reports" / "image-secrets.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    print(
        "PASS four images: nonroot, no generated credentials/private PEMs in config or first-party payloads"
    )


if __name__ == "__main__":
    main()
