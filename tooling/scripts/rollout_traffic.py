"""Authenticated synthetic traffic and bounded evidence; never logs credentials or bodies.

Use dedicated test accounts. Production setup is separate from the no-input deploy
button. This probe measures HTTP, ACL, durable saves and exports, not CRDT convergence.
"""

import argparse
import hashlib
import io
import json
import math
import os
from pathlib import Path
import threading
import time
from urllib.parse import urlparse
import uuid
import zipfile

import requests


class ProbeFailure(ValueError):
    pass


class Measurements:
    def __init__(self):
        self.lock = threading.Lock()
        self.rows = []
        self.failures = []
        self.started = time.monotonic()

    def record(self, operation, status, elapsed, passed):
        with self.lock:
            if len(self.rows) >= 100000:
                raise ProbeFailure("Traffic observation limit exceeded")
            self.rows.append((operation, status, elapsed))
            if not passed:
                self.failures.append({"operation": operation, "status": status})

    def report(self):
        with self.lock:
            latency = sorted(
                row[2] for row in self.rows if not row[0].startswith("slow-")
            )
            transfers = [row[2] for row in self.rows if row[0].startswith("slow-")]
            counts = {"http5xx": 0, "http429": 0, "transportFailures": 0}
            for _, status, _ in self.rows:
                counts["http5xx"] += int(status >= 500)
                counts["http429"] += int(status == 429)
                counts["transportFailures"] += int(status == 0)
            return {
                "scope": "Synthetic authenticated HTTP, save/reopen, ACL and export; CRDT and worker-rebalance proofs are separate",
                "elapsedSeconds": round(time.monotonic() - self.started, 2),
                "requests": len(self.rows),
                "failures": list(self.failures[:100]),
                "failedRequests": len(self.failures),
                "p95Milliseconds": (
                    round(latency[math.ceil(len(latency) * 0.95) - 1], 2)
                    if latency
                    else None
                ),
                "p99Milliseconds": (
                    round(latency[math.ceil(len(latency) * 0.99) - 1], 2)
                    if latency
                    else None
                ),
                "operations": sorted({row[0] for row in self.rows}),
                "slowTransfers": len(transfers),
                "longestTransferMilliseconds": (
                    round(max(transfers), 2) if transfers else None
                ),
                "latencyScope": "p95 excludes intentional transfer throttling; transfers must still complete without errors",
                **counts,
            }


class Client:
    def __init__(self, origin, measurements):
        parsed = urlparse(origin)
        if (
            parsed.scheme not in ("https", "http")
            or parsed.username
            or parsed.password
            or parsed.path not in ("", "/")
            or parsed.query
            or parsed.fragment
        ):
            raise ProbeFailure("Expected an origin without credentials, path or query")
        if parsed.scheme != "https" and parsed.hostname not in (
            "localhost",
            "127.0.0.1",
        ):
            raise ProbeFailure("Remote traffic acceptance requires HTTPS")
        self.origin = origin.rstrip("/")
        self.session = requests.Session()
        self.session.headers["Origin"] = self.origin
        self.measurements = measurements
        self.refreshed = time.monotonic()

    def request(self, operation, method, path, expected=(200,), **kwargs):
        url = path if path.startswith(("https://", "http://")) else self.origin + path
        parsed = urlparse(url)
        local = (parsed.scheme, parsed.netloc) == (
            urlparse(self.origin).scheme,
            urlparse(self.origin).netloc,
        )
        if not local and (
            parsed.scheme != "https"
            or parsed.hostname != "storage.googleapis.com"
            or parsed.username
            or parsed.password
        ):
            raise ProbeFailure("Storage capability host rejected")
        started = time.monotonic()
        status = 0
        try:
            if local:
                response = self.session.request(
                    method, url, timeout=(10, 140), allow_redirects=False, **kwargs
                )
            else:
                # Signed capabilities never receive application cookies, JWT or CSRF.
                response = requests.request(
                    method, url, timeout=(10, 140), allow_redirects=False, **kwargs
                )
            status = response.status_code
        except requests.RequestException:
            response = None
        passed = response is not None and status in expected
        self.measurements.record(
            operation, status, (time.monotonic() - started) * 1000, passed
        )
        if not passed:
            raise ProbeFailure("Synthetic request failed: " + operation)
        return response

    def json(self, operation, method, path, expected=(200,), **kwargs):
        try:
            return self.request(operation, method, path, expected, **kwargs).json()
        except (requests.exceptions.JSONDecodeError, KeyError):
            raise ProbeFailure("Synthetic response validation failed") from None

    def login(self, email, password, register=False):
        csrf = self.json("csrf", "GET", "/api/v1/auth/csrf")
        self.session.headers[csrf["headerName"]] = csrf["token"]
        if register:
            self.request(
                "register",
                "POST",
                "/api/v1/auth/register",
                (201, 409),
                json={
                    "email": email,
                    "password": password,
                    "displayName": "Release acceptance",
                },
            )
        result = self.json(
            "login",
            "POST",
            "/api/v1/auth/login",
            json={"email": email, "password": password},
        )
        self.session.headers["Authorization"] = "Bearer " + result["accessToken"]
        return result["user"]

    def refresh(self):
        if time.monotonic() - self.refreshed > 240:
            csrf = self.json("csrf", "GET", "/api/v1/auth/csrf")
            self.session.headers[csrf["headerName"]] = csrf["token"]
            result = self.json("refresh", "POST", "/api/v1/auth/refresh")
            self.session.headers["Authorization"] = "Bearer " + result["accessToken"]
            self.refreshed = time.monotonic()


def native_fixture(sequence=0, large=False):
    # Valid native v1: bounded synthetic text; the application validates it normally.
    text = (
        ("r" * (8 * 1024 * 1024)).encode()
        if large
        else f"Release acceptance — Tiếng Việt {sequence}\n".encode()
    )
    units = len(text.decode().encode("utf-16-le")) // 2
    import struct

    number, length = units, bytearray()
    while number >= 128:
        length.append((number & 127) | 128)
        number >>= 7
    length.append(number)
    styles = b"TEDSTYLE" + struct.pack("<HHII", 1, 0, units, 1) + b"\0" + length + b"\0"
    manifest = {
        "schemaVersion": 1,
        "textEncoding": "utf-8",
        "internalEol": "LF",
        "preferredExportEol": "LF",
        "exportBom": False,
        "offsetUnit": "utf16",
        "utf8Bytes": len(text),
        "utf16Length": units,
        "logicalLines": text.count(b"\n") + 1,
        "stylesEncoding": "adaptive-v1",
        "textSha256": hashlib.sha256(text).hexdigest(),
        "stylesSha256": hashlib.sha256(styles).hexdigest(),
    }
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        for name, data in (
            ("manifest.json", json.dumps(manifest).encode()),
            ("text.utf8", text),
            ("styles.bin", styles),
        ):
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            # Preserve the immutable fixture originally created by Windows and
            # emit identical archive bytes from Linux CI and operator hosts.
            entry.create_system = 0
            archive.writestr(entry, data)
    return output.getvalue()


class SlowBody(io.BytesIO):
    def __init__(self, data, seconds):
        super().__init__(data)
        self.pause = seconds / 8
        self.chunk = math.ceil(len(data) / 8)

    def read(self, size=-1):
        value = super().read(self.chunk if size != 0 else 0)
        if value and self.pause:
            time.sleep(self.pause)
        return value


class TrafficMonitor:
    def __init__(
        self,
        origin,
        credentials,
        *,
        report,
        slow_seconds=0,
        register=False,
        p95_limit=5000,
        long_download=False,
        persistent=False,
    ):
        self.metrics = Measurements()
        self.owner = Client(origin, self.metrics)
        self.viewer = Client(origin, self.metrics)
        self.credentials = credentials
        if credentials[0] == credentials[2]:
            raise ProbeFailure(
                "Traffic acceptance requires two distinct dedicated accounts"
            )
        self.report_path = Path(report)
        self.slow_seconds = slow_seconds
        self.register = register
        self.p95_limit = p95_limit
        self.stop = threading.Event()
        self.failures = []
        self.threads = []
        self.document = None
        self.commits = 0
        self.exports = 0
        self.fixture = native_fixture()
        self.long_download = long_download
        self.persistent = persistent

    @classmethod
    def environment(cls, report="deployment-evidence/traffic.json"):
        keys = (
            "ROLLOUT_OWNER_EMAIL",
            "ROLLOUT_OWNER_PASSWORD",
            "ROLLOUT_VIEWER_EMAIL",
            "ROLLOUT_VIEWER_PASSWORD",
        )
        if not all(os.environ.get(key) for key in keys):
            raise ProbeFailure(
                "Configure the four dedicated ROLLOUT_* account secrets before deployment"
            )
        return cls(
            os.environ["ORIGIN"],
            [os.environ[key] for key in keys],
            report=report,
            persistent=True,
            long_download=True,
        )

    def prepare(self):
        email, password, viewer_email, viewer_password = self.credentials
        self.owner.login(email, password, self.register)
        self.viewer_user = self.viewer.login(
            viewer_email, viewer_password, self.register
        )
        existing = []
        if self.persistent:
            existing = [
                doc
                for doc in self.owner.json("find-fixture", "GET", "/api/v1/documents")[
                    "items"
                ]
                if doc["title"] == "Release assurance fixture"
            ]
            if len(existing) > 1:
                raise ProbeFailure("Dedicated traffic account has ambiguous fixtures")
        self.document = (
            existing[0]
            if existing
            else self.owner.json(
                "create",
                "POST",
                "/api/v1/documents",
                (201,),
                json={
                    "title": (
                        "Release assurance fixture"
                        if self.persistent
                        else "Release acceptance " + uuid.uuid4().hex[:12]
                    ),
                    "folderId": None,
                },
            )
        )
        path = "/api/v1/documents/" + self.document["id"]
        accessible = self.viewer.request("fixture-acl", "GET", path, (200, 404))
        if accessible.status_code == 404:
            self.owner.request(
                "share-viewer",
                "POST",
                path + "/permissions",
                json={"email": viewer_email, "role": "VIEWER"},
            )
        self.write_cycle()
        self.read_cycle()
        if self.long_download:
            from rollout_transfer import LongTransfer

            downloader = Client(self.owner.origin, self.metrics)
            downloader.login(viewer_email, viewer_password)
            self.transfer = LongTransfer(
                self.owner,
                self.viewer,
                downloader,
                native_fixture(0, large=True),
                viewer_email,
                self.metrics,
            )

    def read_cycle(self):
        self.viewer.refresh()
        self.viewer.json("me", "GET", "/api/v1/auth/me")
        self.viewer.json("list", "GET", "/api/v1/documents?scope=SHARED")
        self.viewer.json("read", "GET", "/api/v1/documents/" + self.document["id"])

    def write_cycle(self):
        self.owner.refresh()
        path = "/api/v1/documents/" + self.document["id"]
        head = self.owner.json("read-head", "GET", path)["headRevision"]
        self.fixture = native_fixture(head)
        ticket = self.owner.json(
            "upload-ticket",
            "POST",
            path + "/uploads",
            (201,),
            json={
                "expectedHeadRevision": head,
                "nativeBytes": len(self.fixture),
                "nativeSha256": hashlib.sha256(self.fixture).hexdigest(),
            },
        )
        self.owner.request(
            "slow-upload" if self.slow_seconds else "upload",
            "PUT",
            ticket["uploadUrl"],
            (200, 201, 204),
            headers=ticket["requiredHeaders"],
            data=SlowBody(self.fixture, self.slow_seconds),
        )
        body = {"uploadId": ticket["uploadId"], "expectedHeadRevision": head}
        key = {"Idempotency-Key": str(uuid.uuid4())}
        saved = self.owner.json(
            "save", "POST", path + "/versions", (200, 201), json=body, headers=key
        )
        retry = self.owner.json(
            "save-retry", "POST", path + "/versions", (200, 201), json=body, headers=key
        )
        if retry != saved or saved["version"]["revision"] != head + 1:
            raise ProbeFailure("Durable save or idempotency assertion failed")
        downloaded = self.owner.request(
            "reopen", "GET", path + f"/versions/{head + 1}/content"
        ).content
        if downloaded != self.fixture:
            raise ProbeFailure("Committed content did not reopen byte-exactly")
        if self.commits == 0:
            self.viewer.request(
                "viewer-write-denied",
                "POST",
                path + "/uploads",
                (403,),
                json={
                    "expectedHeadRevision": head + 1,
                    "nativeBytes": len(self.fixture),
                    "nativeSha256": hashlib.sha256(self.fixture).hexdigest(),
                },
            )
        self.commits += 1
        self.owner.json("subscription", "GET", "/api/v1/billing/subscription")
        if self.commits == 1 or self.commits % 10 == 0:
            self.export(head + 1)

    def export(self, revision):
        job = self.owner.json(
            "export-create",
            "POST",
            "/api/v1/jobs",
            (202,),
            json={
                "documentId": self.document["id"],
                "revision": revision,
                "type": "EXPORT_TXT",
            },
            headers={"Idempotency-Key": str(uuid.uuid4())},
        )
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            state = self.owner.json("export-poll", "GET", "/api/v1/jobs/" + job["id"])
            if state["state"] == "SUCCEEDED":
                result = self.owner.json(
                    "export-download", "GET", "/api/v1/jobs/" + job["id"] + "/download"
                )
                data = self.owner.request(
                    "export-content", "GET", result["url"]
                ).content
                expected = zipfile.ZipFile(io.BytesIO(self.fixture)).read("text.utf8")
                if data.decode("utf-8-sig").replace("\r\n", "\n") != expected.decode():
                    raise ProbeFailure("Export business result mismatch")
                self.exports += 1
                return
            if state["state"] in ("FAILED", "CANCELLED"):
                break
            time.sleep(0.5)
        raise ProbeFailure("Export did not finish successfully")

    def observe(self, action, interval):
        while not self.stop.wait(interval):
            try:
                action()
            except Exception:
                self.failures.append(
                    "Authenticated traffic or business assertion failed"
                )
                self.stop.set()

    def __enter__(self):
        try:
            self.prepare()
            self.threads = [
                threading.Thread(
                    target=self.observe, args=(action, interval), daemon=True
                )
                for action, interval in ((self.read_cycle, 0.5), (self.write_cycle, 5))
            ]
            if self.long_download:
                self.threads.append(
                    threading.Thread(
                        target=self.observe, args=(self.transfer.run, 0), daemon=True
                    )
                )
            for thread in self.threads:
                thread.start()
            if self.long_download and not self.transfer.started.wait(15):
                raise ProbeFailure("Long in-flight request did not start")
            return self
        except Exception:
            self.failures.append("Authenticated preflight failed")
            self.finish()
            raise ProbeFailure(
                "Authenticated traffic preflight failed; inspect bounded evidence"
            ) from None

    def require_healthy(self):
        if self.failures or self.metrics.report()["failedRequests"]:
            raise ProbeFailure(
                "Authenticated release gate failed; inspect bounded traffic evidence"
            )

    def finish(self):
        self.stop.set()
        for thread in self.threads:
            thread.join(timeout=150)
            if thread.is_alive():
                self.failures.append("Traffic observer did not stop")
        if (
            self.document
            and not self.persistent
            and not any(thread.is_alive() for thread in self.threads)
        ):
            try:
                path = "/api/v1/documents/" + self.document["id"]
                current = self.owner.json("cleanup-read", "GET", path)
                self.owner.request(
                    "cleanup-trash",
                    "DELETE",
                    path,
                    (204,),
                    json={"expectedMetadataRevision": current["metadataRevision"]},
                )
            except Exception:
                self.failures.append("Synthetic fixture cleanup failed")
        result = self.metrics.report()
        result.update(
            committedVersions=self.commits,
            verifiedExports=self.exports,
            assertions=self.failures,
        )
        result["status"] = (
            "PASS"
            if not self.failures
            and not result["failedRequests"]
            and result["p95Milliseconds"] is not None
            and result["p95Milliseconds"] <= self.p95_limit
            else "FAIL"
        )
        self.report_path.parent.mkdir(parents=True, exist_ok=True)
        self.report_path.write_text(
            json.dumps(result, indent=2) + "\n", encoding="utf-8"
        )
        self.result = result

    def __exit__(self, exc_type, *unused):
        self.finish()
        if exc_type is None and self.result["status"] != "PASS":
            raise ProbeFailure(
                "Authenticated traffic SLO failed; inspect bounded evidence"
            )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seconds", type=int, default=60)
    parser.add_argument("--slow-seconds", type=float, default=0)
    parser.add_argument(
        "--local",
        action="store_true",
        help="Create dedicated disposable local accounts only",
    )
    args = parser.parse_args()
    if not 1 <= args.seconds <= 3600 or not 0 <= args.slow_seconds <= 100:
        raise ProbeFailure("Invalid bounded traffic duration")
    if args.local:
        from run import initialize

        secret = initialize()["MYSQL_ROOT_PASSWORD"]
        credentials = [
            "smoke-owner@editor.test",
            hashlib.sha256((secret + "smoke-owner@editor.test").encode()).hexdigest()[
                :32
            ],
            "smoke-recipient@editor.test",
            hashlib.sha256(
                (secret + "smoke-recipient@editor.test").encode()
            ).hexdigest()[:32],
        ]
        monitor = TrafficMonitor(
            os.environ.get("EDITOR_BASE_URL", "http://localhost:8080"),
            credentials,
            register=True,
            report="testing/reports/rollout-traffic.json",
            slow_seconds=args.slow_seconds,
            long_download=bool(args.slow_seconds),
            persistent=bool(args.slow_seconds),
        )
    else:
        monitor = TrafficMonitor.environment("testing/reports/rollout-traffic.json")
        monitor.slow_seconds = args.slow_seconds
    with monitor:
        deadline = time.monotonic() + args.seconds
        while time.monotonic() < deadline:
            monitor.require_healthy()
            time.sleep(0.5)
    print("PASS authenticated synthetic traffic; bounded report written")


if __name__ == "__main__":
    main()
