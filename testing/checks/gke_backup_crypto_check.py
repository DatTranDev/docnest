"""Real age archive round trip and tamper rejection; no cloud/SQL restore acceptance."""

import argparse
import contextlib
import io
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

from gke_auto_backup_check import ClusterFixture

from gke_auto_backup import Configuration, capture


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--age-directory", type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    suffix = ".exe" if os.name == "nt" else ""
    executables = {
        name: (
            str(args.age_directory / (name + suffix))
            if args.age_directory
            else shutil.which(name)
        )
        for name in ("age", "age-keygen")
    }
    if not all(executables.values()):
        raise SystemExit("Install age and age-keygen before this real encryption check")

    def command(arguments, *, success=True):
        result = subprocess.run(
            [executables.get(arguments[0], arguments[0]), *arguments[1:]],
            capture_output=True,
            check=False,
            timeout=30,
        )
        if (result.returncode == 0) != success:
            raise SystemExit("Real encryption check failed; protected output withheld")
        return result.stdout

    with tempfile.TemporaryDirectory(prefix="gke-backup-crypto-") as temporary:
        root = Path(temporary)
        key = root / "recipient.key"
        command(["age-keygen", "-o", str(key)])
        recipient = command(["age-keygen", "-y", str(key)]).decode().strip()
        configuration = Configuration(
            "example-lab",
            "asia-southeast1",
            "asia-southeast1-a",
            "example-cluster",
            "example-snapshots",
            "example-results",
            "example-backups",
            recipient,
            "1",
            "gh-123-1",
        )
        cluster = ClusterFixture(configuration)
        fixture = {
            "manifest.json": b'{"fixture":true}',
            "databases.sql": "fixture UTF-8 Tiếng Việt\n".encode(),
            "identity-key.pem": b"synthetic signing-key fixture",
            "objects/generation.bin": os.urandom(4096),
        }
        uploaded = []

        def capture_fixture(arguments):
            arguments.directory.mkdir()
            for name, data in fixture.items():
                target = arguments.directory / name
                target.parent.mkdir(exist_ok=True)
                target.write_bytes(data)

        def execute(arguments):
            if arguments[0] == "age":
                return command(arguments)
            if arguments[:3] != ["gcloud", "storage", "cp"]:
                raise SystemExit("Unexpected cloud command in offline crypto fixture")
            assert arguments[4] == configuration.reference
            assert arguments[3].endswith(".tar.age")
            uploaded.append(Path(arguments[3]).read_bytes())

        with contextlib.redirect_stdout(io.StringIO()):
            capture(
                configuration,
                cluster,
                root,
                capture_backup=capture_fixture,
                execute=execute,
            )
        assert len(uploaded) == 1
        assert uploaded[0].startswith(b"age-encryption.org/v1\n")
        encrypted = root / "capture.tar.age"
        restored = command(["age", "-d", "-i", str(key), str(encrypted)])
        with tarfile.open(fileobj=io.BytesIO(restored)) as archive:
            for name, data in fixture.items():
                assert archive.extractfile("capture/" + name).read() == data
        wrong = root / "wrong.key"
        command(["age-keygen", "-o", str(wrong)])
        command(["age", "-d", "-i", str(wrong), str(encrypted)], success=False)
        damaged = bytearray(uploaded[0])
        damaged[-1] ^= 1
        tampered = root / "tampered.age"
        tampered.write_bytes(damaged)
        command(["age", "-d", "-i", str(key), str(tampered)], success=False)
    print(
        "PASS real age encryption/decryption: archive bytes preserved; wrong key and tampering rejected; cloud restore NOT_RUN"
    )


if __name__ == "__main__":
    main()
