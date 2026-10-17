"""A reusable eight-MiB fixture and bounded slow reader through the public gateway."""

import hashlib
import threading
import time
import uuid


class LongTransfer:
    def __init__(self, owner, viewer, downloader, data, viewer_email, measurements):
        self.client = downloader
        self.metrics = measurements
        self.started = threading.Event()
        self.expected_hash = hashlib.sha256(data).hexdigest()
        self.expected_bytes = len(data)
        matches = [
            doc
            for doc in owner.json("find-long-fixture", "GET", "/api/v1/documents")[
                "items"
            ]
            if doc["title"] == "Release long-request fixture"
        ]
        if len(matches) > 1:
            raise ValueError("Dedicated long-request fixture is ambiguous")
        document = (
            matches[0]
            if matches
            else owner.json(
                "create-long-fixture",
                "POST",
                "/api/v1/documents",
                (201,),
                json={"title": "Release long-request fixture", "folderId": None},
            )
        )
        path = "/api/v1/documents/" + document["id"]
        if document["headRevision"] == 0:
            ticket = owner.json(
                "long-upload-ticket",
                "POST",
                path + "/uploads",
                (201,),
                json={
                    "expectedHeadRevision": 0,
                    "nativeBytes": len(data),
                    "nativeSha256": self.expected_hash,
                },
            )
            owner.request(
                "long-fixture-upload",
                "PUT",
                ticket["uploadUrl"],
                (200, 201, 204),
                headers=ticket["requiredHeaders"],
                data=data,
            )
            owner.json(
                "long-fixture-save",
                "POST",
                path + "/versions",
                (200, 201),
                json={"uploadId": ticket["uploadId"], "expectedHeadRevision": 0},
                headers={"Idempotency-Key": str(uuid.uuid4())},
            )
        elif document["headRevision"] != 1:
            raise ValueError(
                "Dedicated long-request fixture was modified outside acceptance"
            )
        if (
            viewer.request("long-fixture-acl", "GET", path, (200, 404)).status_code
            == 404
        ):
            owner.request(
                "share-long-fixture",
                "POST",
                path + "/permissions",
                json={"email": viewer_email, "role": "VIEWER"},
            )
        self.path = path + "/versions/1/content"

    def run(self):
        self.client.refresh()
        beginning, status, passed = time.monotonic(), 0, False
        try:
            with self.client.session.get(
                self.client.origin + self.path,
                stream=True,
                timeout=(10, 140),
                allow_redirects=False,
            ) as response:
                status = response.status_code
                if status != 200:
                    raise ValueError("Long response status failed")
                self.started.set()
                digest, size = hashlib.sha256(), 0
                for chunk in response.iter_content(65536):
                    size += len(chunk)
                    if size > self.expected_bytes:
                        raise ValueError("Long response exceeded its expected bound")
                    digest.update(chunk)
                    time.sleep(len(chunk) / (128 * 1024))
                passed = (
                    size == self.expected_bytes
                    and digest.hexdigest() == self.expected_hash
                )
        finally:
            self.metrics.record(
                "slow-download", status, (time.monotonic() - beginning) * 1000, passed
            )
        if not passed:
            raise ValueError("Long response was interrupted or corrupted")
