"""LOCAL adapter recovery bytes from exact SQL references; never stops applications."""

import hashlib
import json
import re

from cloud_backup import REF_KEYS, capture_records, fingerprint


def identity(ref):
    if (
        set(ref) != REF_KEYS
        or ref["provider"] != "LOCAL"
        or ref["bucket"] is not None
        or ref["generation"] != "1"
        or not isinstance(ref["key"], str)
        or not re.fullmatch(r"(?:snapshots|results)/[A-Za-z0-9_./-]{1,500}", ref["key"])
        or any(part in ("", ".", "..") for part in ref["key"].split("/"))
    ):
        raise ValueError("Unsafe or non-LOCAL immutable reference")
    return (ref["key"], ref["generation"])


def refs(value):
    if isinstance(value, dict):
        if set(value) == REF_KEYS:
            identity(value)
            yield value
        else:
            for child in value.values():
                yield from refs(child)
    elif isinstance(value, list):
        for child in value:
            yield from refs(child)


def capture(sandbox, directory, document_container, identity_container):
    from online_backup import run

    for name in (document_container, identity_container):
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{1,100}", name):
            raise ValueError("Explicit local application containers required")
    records = capture_records(sandbox)
    required = {
        identity(ref): ref
        for row in records
        if row["required"]
        for ref in refs(row["value"])
    }
    hashes = {
        identity(row["ref"]): row["sha256"]
        for row in sandbox.query(
            "document_db",
            "SELECT JSON_OBJECT('ref',JSON_OBJECT('provider',storage_provider,'bucket',storage_bucket,'key',object_key,'generation',object_generation),'sha256',native_sha256) FROM document_versions WHERE object_deleted_at IS NULL;",
        )
    }
    (directory / "objects").mkdir()
    entries = []
    for key, ref in sorted(required.items()):
        name = hashlib.sha256(json.dumps(key).encode()).hexdigest() + ".bin"
        target = directory / "objects" / name
        run(
            [
                "docker",
                "cp",
                document_container + ":/data/objects/" + ref["key"],
                str(target),
            ]
        )
        digest = fingerprint(target)
        if key in hashes and hashes[key] != digest:
            raise ValueError("LOCAL native content hash mismatch")
        entries.append(
            {"ref": ref, "file": name, "sha256": digest, "bytes": target.stat().st_size}
        )
    run(
        [
            "docker",
            "cp",
            identity_container + ":/data/keys/identity-key.pem",
            str(directory / "identity-key.pem"),
        ]
    )
    return {
        "storageMode": "LOCAL",
        "objects": entries,
        "records": records,
        "localKeySha256": fingerprint(directory / "identity-key.pem"),
    }
