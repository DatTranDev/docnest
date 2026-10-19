"""Versioned migration review for mixed-version rolling releases."""

import hashlib
import json
from pathlib import Path
import subprocess

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
        validate_reviewed_contract_change(impact)
    validate_policy()


def validate_reviewed_contract_change(impact, root=ROOT):
    message = (
        "Protocol/native changes require a staged backward-compatible rollout plan; "
        "there is no downtime deployment fallback"
    )
    policy = json.loads((root / "infra/k8s/rolling-contracts.json").read_text())
    base = impact.get("base")
    head = impact.get("head")
    contracts = policy.get("reviewedContractChanges")
    if (
        policy.get("schemaVersion") != 1
        or impact.get("reason") != "git-diff"
        or base != policy.get("baselineCommit")
        or not isinstance(head, str)
        or not isinstance(contracts, dict)
        or not contracts
    ):
        raise ValueError(message)
    changed = (
        subprocess.check_output(
            [
                "git",
                "diff",
                "--name-only",
                "--no-renames",
                "-z",
                base,
                head,
                "--",
                "docs/contracts",
                "backend/common",
            ],
            cwd=root,
        )
        .decode()
        .strip("\0")
        .split("\0")
    )
    if set(changed) != set(contracts) or len(changed) != len(contracts):
        raise ValueError(message)
    for path, hashes in contracts.items():
        if (
            not path.startswith("docs/contracts/")
            or not isinstance(hashes, dict)
            or set(hashes) != {"beforeSha256", "afterSha256"}
        ):
            raise ValueError(message)
        for revision, key in ((base, "beforeSha256"), (head, "afterSha256")):
            content = subprocess.check_output(
                ["git", "show", f"{revision}:{path}"], cwd=root
            )
            if hashlib.sha256(content).hexdigest() != hashes[key]:
                raise ValueError(message)
