"""Install checksum-pinned official age tools for Linux amd64 acceptance runners."""

import hashlib
import io
from pathlib import Path
import platform
import tarfile
import urllib.request

VERSION = "1.3.2"
SHA256 = "cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10"


def main():
    if platform.system() != "Linux" or platform.machine() not in ("x86_64", "AMD64"):
        raise ValueError("This CI installer supports Linux amd64 only")
    url = f"https://github.com/FiloSottile/age/releases/download/v{VERSION}/age-v{VERSION}-linux-amd64.tar.gz"
    with urllib.request.urlopen(url, timeout=60) as response:
        data = response.read(32 * 1024 * 1024 + 1)
    if len(data) > 32 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != SHA256:
        raise ValueError("Official age archive checksum mismatch")
    destination = Path(__file__).resolve().parents[2] / f".tools/age/{VERSION}/age"
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for name in ("age", "age-keygen"):
            member = archive.getmember("age/" + name)
            if not member.isfile() or member.size > 16 * 1024 * 1024:
                raise ValueError("age executable archive member rejected")
            target = destination / name
            target.write_bytes(archive.extractfile(member).read())
            target.chmod(0o755)
    print("Installed checksum-verified official age " + VERSION)


if __name__ == "__main__":
    main()
