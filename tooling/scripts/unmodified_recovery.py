"""Fenced reconciliation only when no application image/template/Pod changed.

Never applies workloads, restores SQL, resets events or approves the unpublished
candidate's event compatibility. Traffic writes only dedicated synthetic fixtures.
Original failed artifacts stay PENDING.
"""

import argparse
import copy
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import time
import uuid

from digest_manifest import NAMES
from online_backup import Source
from release_recovery import (
    Cluster,
    approve,
    command,
    fingerprint,
    read,
    require_frozen_workflow,
    validate_states,
)
from rollout_traffic import TrafficMonitor
from routine_release import evidence_inventory, validate_live
from routine_rollout import AvailabilityMonitor
from unmodified_recovery_evidence import (
    OperatorPodSchemaSource,
    baseline_evidence,
    expected_schema,
    failed_evidence,
    schema_state,
)

DECISION = "operator-approved-unmodified-application-reconciliation"
MIGRATION_ARGS = ["--editor.migrate-only=true", "--spring.flyway.enabled=true"]


def application_inventory(live, jobs):
    pods = []
    for pod in live["pods"]:
        owners = [
            owner
            for owner in pod["metadata"].get("ownerReferences", [])
            if owner.get("controller") is True
        ]
        owned = [
            owner
            for owner in owners
            if owner.get("kind") == "Job" and owner.get("name") in jobs
        ]
        if owned:
            owner = owned[0]
            job = jobs[owner["name"]]
            containers = pod["spec"]["containers"]
            expected = job["spec"]["template"]["spec"]["containers"][0]
            if (
                len(owners) != 1
                or owner["uid"] != job["metadata"]["uid"]
                or pod.get("status", {}).get("phase") != "Succeeded"
                or len(containers) != 1
                or containers[0]["image"] != expected["image"]
                or containers[0].get("args") != MIGRATION_ARGS
                or containers[0].get("command")
            ):
                raise ValueError(
                    "Only the exact completed migrate-only Job Pod can be excluded"
                )
            continue
        pods.append(pod)
    return {**live, "pods": pods}


def stage_jobs(bundle, failed):
    deployment = bundle["deployment"]
    affected = deployment["affected.json"]
    owners = affected["migrations"]
    selected = failed.get("selectedServices")
    if (
        affected.get("coordinated") is not False
        or not isinstance(selected, list)
        or len(set(selected)) != len(selected)
        or set(selected) != set(affected["applications"])
        or not set(selected) <= set(NAMES)
    ):
        raise ValueError("Unreviewed application/protocol scope cannot reconcile")
    jobs = {
        owner: "migrate-"
        + owner
        + "-gh-"
        + bundle["runId"]
        + "-"
        + str(bundle["runAttempt"])
        for owner in owners
    }
    stages = deployment["stages.json"]
    if not stages or any(row.get("exitCode") != 0 for row in stages):
        raise ValueError("A failed or missing stage requires manual incident review")
    names = [row["stage"] for row in stages]
    if names.count("apply-config") != 1:
        raise ValueError("Require exactly one unchanged configuration apply")
    split = names.index("apply-config")
    validations = {
        "validate-config",
        *("validate-" + name for name in selected),
        *("validate-" + name for name in jobs.values()),
    }
    if len(names[:split]) != len(validations) or set(names[:split]) != validations:
        raise ValueError("Every server validation must precede mutation")
    expected = ["apply-config"]
    for owner in owners:
        expected.extend((jobs[owner], "wait-" + jobs[owner]))
    if names[split:] != expected:
        raise ValueError(
            "Application apply or incomplete migration cannot use unmodified reconciliation"
        )
    return jobs


def make_plan(
    context, failed, baseline, bundle, live, jobs, config_hash, histories, server_uuid
):
    expected = expected_schema(bundle, failed, baseline)
    names = stage_jobs(bundle, failed)
    if (
        failed.get("previousConfigSha256") != failed.get("desiredConfigSha256")
        or config_hash != failed.get("previousConfigSha256")
        or not re.fullmatch(r"[a-f0-9]{64}", config_hash)
    ):
        raise ValueError(
            "Configuration changed; unmodified reconciliation is forbidden"
        )
    if histories != expected:
        raise ValueError(
            "Live owning SQL histories differ from the actual compatibility drill"
        )
    if set(jobs) != set(names.values()):
        raise ValueError("Missing or unexpected owning migration Job evidence")
    completed = {}
    for owner, name in names.items():
        job = jobs[name]
        status = job.get("status", {})
        containers = job["spec"]["template"]["spec"]["containers"]
        if (
            job["metadata"].get("namespace") != "editor-lab"
            or job["metadata"].get("labels", {}).get("application") != "text-editor"
            or len(containers) != 1
            or containers[0]["image"] != failed["images"][owner]
            or containers[0].get("args") != MIGRATION_ARGS
            or containers[0].get("command")
            or status.get("active", 0) != 0
            or status.get("failed", 0) != 0
            or status.get("succeeded") != 1
            or not any(
                row.get("type") == "Complete" and row.get("status") == "True"
                for row in status.get("conditions", [])
            )
        ):
            raise ValueError(
                "The exact owning migration job is not successfully complete"
            )
        completed[name] = {
            "uid": job["metadata"]["uid"],
            "image": containers[0]["image"],
            "succeeded": 1,
        }
    application_live = application_inventory(live, jobs)
    validate_live(baseline, application_live)
    after = evidence_inventory(application_live)
    before = bundle["deployment"]["before.json"]
    if after != before:
        raise ValueError(
            "Application image, template, replica, Deployment or Pod identity changed"
        )
    return {
        "schemaVersion": 1,
        "action": "reconcile-unmodified-applications",
        "approved": False,
        "context": context,
        "namespace": "editor-lab",
        "selectedServices": [],
        "targetImages": baseline["images"],
        "failedStateSha256": fingerprint(failed),
        "baselineSha256": fingerprint(baseline),
        "beforeSha256": fingerprint(before),
        "afterSha256": fingerprint(after),
        "stagesSha256": fingerprint(bundle["deployment"]["stages.json"]),
        "configurationSha256": config_hash,
        "mysqlServerUuid": server_uuid,
        "flywayHistorySha256": histories,
        "migrationJobsSha256": fingerprint(completed),
        "schemaEvidenceSha256": fingerprint(
            {
                "schemas": bundle["schemas"],
                "fileHashes": bundle["schemaFileHashes"],
                "artifactIds": bundle["artifactIds"],
            }
        ),
        "candidateEventCompatibility": "NOT_ASSERTED; no application image/template/Pod mutation is permitted",
        "expiresAt": (
            dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)
        ).isoformat(),
    }


def capture(cluster, job_names):
    live = {
        "deployments": cluster.inventory(),
        "pods": json.loads(command(cluster.prefix + ["get", "pods", "-o", "json"]))[
            "items"
        ],
    }
    jobs = {
        name: json.loads(command(cluster.prefix + ["get", "job", name, "-o", "json"]))
        for name in job_names.values()
    }
    config = json.loads(
        command(cluster.prefix + ["get", "configmap", "editor-config", "-o", "json"])
    )["data"]
    digest = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
    return live, jobs, digest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["plan", "execute"])
    for name in ("context", "project", "region", "repository", "server-uuid"):
        parser.add_argument("--" + name, required=True)
    for name in ("failed", "baseline", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    source_options = parser.add_mutually_exclusive_group(required=True)
    source_options.add_argument("--mysql-defaults", type=Path)
    source_options.add_argument(
        "--operator-pod-schema",
        action="store_true",
        help="Use existing operator Pod-exec access for fixed Flyway/UUID queries and DDL fencing only",
    )
    parser.add_argument("--approval", type=Path)
    args = parser.parse_args()
    if str(uuid.UUID(args.server_uuid)) != args.server_uuid:
        raise ValueError("Canonical verified MySQL UUID required")
    failed, baseline = read(args.failed), read(args.baseline)
    validate_states(failed, baseline, args.project, args.region, args.repository)
    require_frozen_workflow(args.repository)
    bundle = failed_evidence(failed, args.repository)
    baseline = baseline_evidence(baseline, args.repository)
    job_names = stage_jobs(bundle, failed)
    source = (
        OperatorPodSchemaSource(args.context)
        if args.operator_pod_schema
        else Source(defaults=args.mysql_defaults)
    )
    cluster = Cluster(args.context)

    def current_plan():
        live, jobs, config_hash = capture(cluster, job_names)
        histories = schema_state(source, args.server_uuid)
        return make_plan(
            args.context,
            failed,
            baseline,
            bundle,
            live,
            jobs,
            config_hash,
            histories,
            args.server_uuid,
        )

    plan = current_plan()
    args.output.mkdir(parents=True, exist_ok=True)
    if args.action == "plan":
        (args.output / "recovery-plan.json").write_text(
            json.dumps(plan, indent=2) + "\n", encoding="utf-8"
        )
        print(
            "Unmodified-application reconciliation plan written; no workload or SQL mutation"
        )
        return
    if not args.approval:
        raise ValueError("Execution requires the reviewed --approval file")
    reviewed = read(args.approval)
    with source.ddl_fence():
        require_frozen_workflow(args.repository)
        approve(reviewed, current_plan())
        (args.output / "recovery-attempt.json").write_text(
            json.dumps({"status": "PENDING", "planSha256": fingerprint(plan)}, indent=2)
            + "\n",
            encoding="utf-8",
        )

        def query(*parts):
            return json.loads(command(cluster.prefix + [*parts, "-o", "json"]))

        with (
            TrafficMonitor.environment(str(args.output / "traffic.json")) as traffic,
            AvailabilityMonitor(
                NAMES,
                query=query,
                origin=traffic.owner.origin,
                report=str(args.output / "availability.json"),
            ) as availability,
        ):
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                traffic.require_healthy()
                availability.require_healthy()
                time.sleep(1)
        if availability.failures:
            raise ValueError("Unmodified recovery availability failed")
        require_frozen_workflow(args.repository)
        final = current_plan()
        approve(reviewed, final)
    recovered = copy.deepcopy(baseline)
    recovered.update(
        rolloutStatus="PASS",
        selectedServices=[],
        appliedMigrationHistorySha256=final["flywayHistorySha256"],
    )
    recovered["recoveryOf"] = {
        "failedStateSha256": fingerprint(failed),
        "runUrl": failed["runUrl"],
        "decision": DECISION,
        "applicationMutationAbsent": True,
        "beforeSha256": final["beforeSha256"],
        "afterSha256": final["afterSha256"],
        "stagesSha256": final["stagesSha256"],
        "compatibilitySha256": final["schemaEvidenceSha256"],
        "configurationSha256": final["configurationSha256"],
        "trafficSha256": fingerprint(read(args.output / "traffic.json")),
        "verifiedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    (args.output / "recovered-environment-state.json").write_text(
        json.dumps(recovered, indent=2) + "\n", encoding="utf-8"
    )
    (args.output / "recovery-attempt.json").write_text(
        json.dumps({"status": "PASS", "stateSha256": fingerprint(recovered)}, indent=2)
        + "\n",
        encoding="utf-8",
    )
    print(
        "Application state reconciled; original failure retained, no workloads patched or SQL restored; synthetic traffic verified"
    )


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit(
            "Unmodified reconciliation failed; no approved recovery state. Protected output withheld."
        ) from None
