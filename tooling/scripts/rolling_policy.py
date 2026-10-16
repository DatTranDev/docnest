"""Versioned migration review for mixed-version rolling releases."""

import hashlib
import json
from pathlib import Path

from digest_manifest import NAMES

ROOT = Path(__file__).resolve().parents[2]


def migration_hash(path):
    return hashlib.sha256(path.read_text(encoding="utf-8").encode("utf-8")).hexdigest()


def validate_policy(root=ROOT):
    policy = json.loads((root / "infra/k8s/rolling-migrations.json").read_text())
    if policy.get("schemaVersion") != 1:
        raise ValueError("Unsupported rolling migration policy")
    actual = {}
    for name in NAMES[:-1]:
        folder = root / f"backend/{name}/src/main/resources/db/migration"
        for path in folder.rglob("*.sql"):
            mirror = (
                root
                / "backend/schema"
                / name.removesuffix("-service")
                / path.relative_to(folder)
            )
            digest = migration_hash(path)
            if not mirror.is_file() or migration_hash(mirror) != digest:
                raise ValueError(
                    "Migration resource/schema copies differ: " + path.name
                )
            actual[path.relative_to(root).as_posix()] = digest
    if policy.get("reviewedExpandMigrations") != actual:
        raise ValueError(
            "SQL requires hash-bound expand-only review in infra/k8s/rolling-migrations.json; "
            "incompatible migrations must be split into compatible releases"
        )


def validate_compatibility(impact):
    if impact["coordinated"]:
        raise ValueError(
            "Protocol/native changes require a staged backward-compatible rollout plan; "
            "there is no downtime deployment fallback"
        )
    validate_policy()
