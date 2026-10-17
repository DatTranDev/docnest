"""Trusted artifact and schema evidence for reconciliation before any app mutation."""

import hashlib
import io
import json
import os
import re
import shlex
import zipfile

from deployment_state import Actions, WORKFLOWS, run_states
from digest_manifest import NAMES
from online_backup import Source
from release_recovery import Cluster, fingerprint

OWNERS = ("identity", "document", "processing", "collaboration", "payment")
UUID_QUERY = "SELECT JSON_OBJECT('serverUuid',@@server_uuid);"


def history_query(owner):
    if owner not in OWNERS:
        raise ValueError("Unknown schema owner")
    return (
        "SELECT JSON_OBJECT('owner','"
        + owner
        + "','version',version,'checksum',checksum,'success',success) FROM "
        + owner
        + "_db.flyway_schema_history WHERE version IS NOT NULL ORDER BY installed_rank;"
    )


class OperatorPodSchemaSource(Source):
    """Explicit operator-only port: fixed schema queries/fence, no credential export.

    Uses the operator's existing Pod-exec capability and pod-local bootstrap
    credential. It grants nothing to deployment/backup identities, exposes no
    network listener and accepts no business-table SQL or backup export commands.
    Prefer the dedicated external schema reader when available.
    """

    def __init__(self, context):
        self.prefix = Cluster(context).prefix

    def command(self, tool, options=()):
        if tool != "mysql" or not set(options) <= {
            "--batch",
            "--raw",
            "--unbuffered",
            "--skip-column-names",
            "--skip-reconnect",
        }:
            raise ValueError("Operator schema source only supports the MySQL client")
        return [
            *self.prefix,
            "exec",
            "-i",
            "mysql-0",
            "--",
            "bash",
            "-c",
            'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec '
            + shlex.join(["mysql", "--user=root", *options]),
        ]

    def query(self, sql):
        if sql not in (UUID_QUERY, *(history_query(owner) for owner in OWNERS)):
            raise ValueError(
                "Only the fixed server-UUID and Flyway queries are allowed"
            )
        return super().query(sql)


def schema_state(source, server_uuid):
    if source.query(UUID_QUERY) != [{"serverUuid": server_uuid}]:
        raise ValueError("Source MySQL server UUID differs from the reviewed database")
    histories = {}
    for owner in OWNERS:
        rows = source.query(history_query(owner))
        if not rows or any(row.get("success") != 1 for row in rows):
            raise ValueError("Unsuccessful or missing owning migration history")
        histories[owner] = hashlib.sha256(
            json.dumps(rows, sort_keys=True).encode()
        ).hexdigest()
    return histories


def artifact_files(actions, artifact, names):
    result, hashes = {}, {}
    raw = actions.request(
        "actions/artifacts/" + str(artifact["id"]) + "/zip", binary=True
    )
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        total = 0
        for entry in archive.infolist():
            name = entry.filename.rsplit("/", 1)[-1]
            if name not in names:
                continue
            total += entry.file_size
            if name in result or entry.file_size > 1024**2 or total > 2 * 1024**2:
                raise ValueError("Duplicated or oversized recovery evidence")
            data = archive.read(entry)
            result[name] = json.loads(data)
            hashes[name] = hashlib.sha256(data).hexdigest()
    if set(result) != set(names):
        raise ValueError("Required immutable recovery evidence is missing")
    return result, hashes


def baseline_evidence(baseline, repository):
    match = re.fullmatch(
        re.escape(repository) + r"/actions/runs/([1-9][0-9]*)", baseline["runUrl"]
    )
    if not match:
        raise ValueError("Baseline URL is outside the reviewed repository")
    actions = Actions()
    run = actions.request("actions/runs/" + match[1])
    if (
        run.get("status") != "completed"
        or run.get("conclusion") != "success"
        or run.get("head_branch") != "main"
        or run.get("event") != "workflow_dispatch"
        or run.get("path") not in WORKFLOWS
        or run.get("head_sha") != baseline["commit"]
    ):
        raise ValueError(
            "The original image baseline is not a successful protected main run"
        )
    keys = (
        "schemaVersion",
        "environment",
        "ref",
        "commit",
        "runUrl",
        "nativeFormatVersion",
        "googleClientId",
        "images",
        "imageProvenance",
    )
    for state in run_states(actions, match[1]):
        if state.get("rolloutStatus") == "PASS" and all(
            state.get(key) == baseline.get(key) for key in keys
        ):
            # Do not carry unverified extra approval/profile fields into a new state.
            return state
    raise ValueError(
        "Supplied baseline differs from original retained image provenance"
    )


def failed_evidence(failed, repository):
    if repository != "https://github.com/" + os.environ.get("GITHUB_REPOSITORY", ""):
        raise ValueError("Recovery repository differs from authenticated Actions scope")
    match = re.fullmatch(
        re.escape(repository) + r"/actions/runs/([1-9][0-9]*)", failed["runUrl"]
    )
    if not match:
        raise ValueError("Failed release URL is outside the reviewed repository")
    actions = Actions()
    run = actions.request("actions/runs/" + match[1])
    if (
        run.get("status") != "completed"
        or run.get("conclusion") not in ("failure", "cancelled")
        or run.get("event") != "workflow_dispatch"
        or run.get("head_branch") != "main"
        or run.get("head_sha") != failed["commit"]
        or run.get("path") not in WORKFLOWS
    ):
        raise ValueError(
            "Only the exact completed failed protected main run can reconcile"
        )
    artifacts = {}
    for artifact in actions.pages(
        "actions/runs/" + match[1] + "/artifacts", "artifacts"
    ):
        name = artifact["name"]
        if (
            name in ("deployment-evidence", "cloud-image-scan-evidence")
            and not artifact["expired"]
            and artifact["id"] > artifacts.get(name, {}).get("id", 0)
        ):
            artifacts[name] = artifact
    if set(artifacts) != {"deployment-evidence", "cloud-image-scan-evidence"}:
        raise ValueError("Original run evidence is missing or expired")
    deployment, _ = artifact_files(
        actions,
        artifacts["deployment-evidence"],
        {"environment-state.json", "before.json", "stages.json", "affected.json"},
    )
    if fingerprint(deployment["environment-state.json"]) != fingerprint(failed):
        raise ValueError(
            "Supplied failed state differs from its immutable Actions artifact"
        )
    owners = deployment["affected.json"]["migrations"]
    if (
        not owners
        or len(set(owners)) != len(owners)
        or not set(owners) <= set(NAMES[:-1])
    ):
        raise ValueError(
            "This schema-backed reconciliation requires reviewed migration owners"
        )
    names = {
        "mixed-version-gate.json",
        *("mixed-schema-" + owner + ".json" for owner in owners),
    }
    schemas, hashes = artifact_files(
        actions, artifacts["cloud-image-scan-evidence"], names
    )
    return {
        "deployment": deployment,
        "schemas": schemas,
        "schemaFileHashes": hashes,
        "runAttempt": run["run_attempt"],
        "runId": match[1],
        "artifactIds": {name: value["id"] for name, value in artifacts.items()},
    }


def expected_schema(bundle, failed, baseline):
    owners = bundle["deployment"]["affected.json"]["migrations"]
    gate = bundle["schemas"]["mixed-version-gate.json"]
    if (
        gate.get("status") != "PASS"
        or gate.get("owners") != owners
        or len(gate.get("checks", [])) != len(owners)
    ):
        raise ValueError("Actual migration compatibility gate is incomplete")
    histories = None
    for owner in owners:
        name = "mixed-schema-" + owner + ".json"
        report = bundle["schemas"][name]
        checks = [row for row in gate["checks"] if row.get("service") == owner]
        image_id = failed["imageProvenance"][owner]["scan"]["imageId"]
        if (
            len(checks) != 1
            or checks[0].get("reportSha256") != bundle["schemaFileHashes"][name]
            or checks[0].get("oldImage") != baseline["images"][owner]
            or checks[0].get("newImageId") != image_id
            or report.get("status") != "PASS"
            or report.get("schemaCompatible") is not True
            or report.get("nativeFormatVersion") != 6
            or report.get("oldImages", {}).get(owner) != baseline["images"][owner]
            or report.get("resolvedNewImages", {}).get(owner) != image_id
        ):
            raise ValueError(
                "Old-image schema proof does not bind the actual scanned candidate"
            )
        current = report.get("flywayHistorySha256", {})
        if (
            set(current) != set(OWNERS)
            or any(
                not re.fullmatch(r"[a-f0-9]{64}", value) for value in current.values()
            )
            or (histories is not None and histories != current)
        ):
            raise ValueError("Candidate schema proofs disagree or omit an owner")
        histories = current
    return histories
