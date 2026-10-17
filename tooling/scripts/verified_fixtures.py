"""Package same-run verified output for local acceptance, without recompiling it.

Uses private build contexts containing only runtime files. Cloud publication still
builds and scans its own exact selected images; these are disposable test fixtures.
"""

import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import uuid

from digest_manifest import NAMES

ROOT = Path(__file__).resolve().parents[2]


def build():
    started = time.monotonic()
    records = []
    refresh = uuid.uuid4().hex
    # Require every output before replacing any local image tag.
    jars = {
        name: ROOT / f"backend/{name}/target/{name}-1.0.0-SNAPSHOT.jar"
        for name in NAMES[:-1]
    }
    required = list(jars.values())
    if not all(path.is_file() for path in required):
        raise ValueError("Run Maven verify before --verified-output")
    with tempfile.TemporaryDirectory(prefix="docsnest-verified-") as directory:
        folder = Path(directory)
        for name in NAMES[:-1]:
            context = folder / name
            context.mkdir()
            shutil.copyfile(jars[name], context / "app.jar")
            fingerprint = hashlib.sha256(jars[name].read_bytes()).hexdigest()
            stage = time.monotonic()
            subprocess.run(
                [
                    "docker",
                    "build",
                    "-f",
                    str(ROOT / "infra/compose/VerifiedService.Dockerfile"),
                    "-t",
                    f"text-editor/{name}:local",
                    "--build-arg",
                    "SECURITY_REFRESH=" + refresh,
                    str(context),
                ],
                check=True,
            )
            records.append(
                {
                    "service": name,
                    "verifiedOutputSha256": fingerprint,
                    "durationSeconds": round(time.monotonic() - stage, 2),
                }
            )
    # Keep the production Alpine build: host glibc/Windows native modules must not
    # be copied into a musl runtime, even for acceptance fixtures.
    stage = time.monotonic()
    subprocess.run(
        [
            "docker",
            "build",
            "-f",
            str(ROOT / "infra/compose/Web.Dockerfile"),
            "-t",
            "text-editor/web:local",
            "--build-arg",
            "SECURITY_REFRESH=" + refresh,
            str(ROOT),
        ],
        check=True,
    )
    records.append(
        {
            "service": "web",
            "build": "production Alpine build/runtime",
            "durationSeconds": round(time.monotonic() - stage, 2),
        }
    )
    target = ROOT / "testing/reports/verified-fixtures.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(
            {
                "scope": "local acceptance fixtures only",
                "durationSeconds": round(time.monotonic() - started, 2),
                "images": records,
            },
            indent=2,
        )
        + "\n"
    )
