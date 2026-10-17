"""Plan and explicitly approve image-only recovery; never changes SQL, config or replicas.

The operator supplies downloaded failed/baseline artifacts and actual compatibility
evidence. A plan alone cannot mutate the cluster. Outputs contain bounded identifiers.
"""

import argparse
import copy
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time

from digest_manifest import NAMES, validate_manifest
from release_manifest import validate_provenance
from rollout_traffic import TrafficMonitor
from routine_rollout import AvailabilityMonitor
from online_backup import Source
from deployment_state import Actions, WORKFLOWS


def fingerprint(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def read(path):
    if path.stat().st_size > 2 * 1024 * 1024:
        raise ValueError("Recovery input exceeds the size limit")
    return json.loads(path.read_text(encoding="utf-8"))


def command(args):
    try:
        result = subprocess.run(
            args, capture_output=True, timeout=420, text=True, encoding="utf-8"
        )
    except (OSError, subprocess.TimeoutExpired):
        raise ValueError(
            "Recovery command unavailable or timed out; protected output withheld"
        ) from None
    if result.returncode:
        raise ValueError("Recovery command failed; protected output withheld")
    return result.stdout


class Cluster:
    def __init__(self, context):
        if (
            not context
            or context.startswith("-")
            or not re.fullmatch(r"[A-Za-z0-9_.:/-]{1,250}", context)
        ):
            raise ValueError("Supply the explicit reviewed Kubernetes context")
        self.prefix = ["kubectl", "--context", context, "-n", "editor-lab"]

    def inventory(self):
        return {
            name: json.loads(
                command(self.prefix + ["get", "deployment", name, "-o", "json"])
            )
            for name in NAMES
        }


def bounded(live):
    return {
        name: {
            "uid": obj["metadata"]["uid"],
            "resourceVersion": obj["metadata"]["resourceVersion"],
            "templateSha256": fingerprint(obj["spec"]["template"]),
            "image": obj["spec"]["template"]["spec"]["containers"][0]["image"],
            "replicas": obj["spec"].get("replicas", 1),
        }
        for name, obj in live.items()
    }


def validate_states(failed, baseline, project, region, repository):
    for state in (failed, baseline):
        validate_manifest(state["images"], project, region)
        validate_provenance(state["imageProvenance"], state["images"], repository)
        if (
            state.get("schemaVersion") != 2
            or state.get("nativeFormatVersion") != 6
            or state.get("environment") != "cloud-gke"
            or state.get("ref") != "refs/heads/main"
        ):
            raise ValueError("Protected full V2 states are required")
    if (
        failed.get("rolloutStatus") != "PENDING"
        or failed.get("mutationStarted") is not True
        or baseline.get("rolloutStatus") != "PASS"
        or failed.get("previousImages") != baseline["images"]
    ):
        raise ValueError(
            "Recovery requires the exact successful predecessor of the interrupted mutation"
        )


def make_plan(
    context, failed, baseline, before, live, compatibility, *, target="previous"
):
    # Evidence must come from real old/new-image tests, including applied-schema hashes.
    if (
        compatibility.get("status") != "PASS"
        or compatibility.get("oldImages") != baseline["images"]
        or compatibility.get("newImages") != failed["images"]
        or compatibility.get("schemaCompatible") is not True
        or compatibility.get("eventsCompatible") is not True
        or compatibility.get("nativeFormatVersion") != 6
        or set(compatibility.get("flywayHistorySha256", {}))
        != {"identity", "document", "processing", "collaboration", "payment"}
        or any(
            not re.fullmatch(r"[a-f0-9]{64}", value)
            for value in compatibility.get("flywayHistorySha256", {}).values()
        )
    ):
        raise ValueError(
            "Actual hash-bound schema/event/native compatibility evidence is required"
        )
    targets = []
    for name in NAMES:
        obj = live[name]
        containers = obj["spec"]["template"]["spec"]["containers"]
        previous = before["deployments"][name]
        if (
            len(containers) != 1
            or obj["metadata"]["uid"] != previous["uid"]
            or obj["spec"].get("replicas", 1) != previous["replicas"]
        ):
            raise ValueError(
                "Deployment identity or replica ownership changed: " + name
            )
        image = containers[0]["image"]
        if target == "current":
            actual_hash = hashlib.sha256(
                json.dumps(obj["spec"]["template"], sort_keys=True).encode()
            ).hexdigest()
            if image != failed["images"][name] or actual_hash != failed.get(
                "desiredTemplateSha256", {}
            ).get(name):
                raise ValueError(
                    "Live state does not match the complete normalized desired release: "
                    + name
                )
            continue
        if image not in (failed["images"][name], baseline["images"][name]):
            raise ValueError("Unreviewed live image: " + name)
        original = copy.deepcopy(obj["spec"]["template"])
        original["spec"]["containers"][0]["image"] = baseline["images"][name]
        # Match the pre-release raw template hash, preserving config/keys/drain/security.
        old_hash = hashlib.sha256(
            json.dumps(original, sort_keys=True).encode()
        ).hexdigest()
        if old_hash != previous["templateSha256"]:
            raise ValueError(
                "Image-only recovery cannot revert changed configuration/template: "
                + name
            )
        if image != baseline["images"][name]:
            targets.append(name)
    return {
        "schemaVersion": 1,
        "action": "rollback-images" if target == "previous" else "reconcile-current",
        "approved": False,
        "context": context,
        "namespace": "editor-lab",
        "selectedServices": targets,
        "failedStateSha256": fingerprint(failed),
        "baselineSha256": fingerprint(baseline),
        "liveInventorySha256": fingerprint(bounded(live)),
        "compatibilitySha256": fingerprint(compatibility),
        "expiresAt": (
            dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)
        ).isoformat(),
    }


def verify_schema(source, compatibility):
    actual = {}
    for owner in ("identity", "document", "processing", "collaboration", "payment"):
        rows = source.query(
            "SELECT JSON_OBJECT('owner','"
            + owner
            + "','version',version,'checksum',checksum,'success',success) FROM "
            + owner
            + "_db.flyway_schema_history WHERE version IS NOT NULL ORDER BY installed_rank;"
        )
        actual[owner] = hashlib.sha256(
            json.dumps(rows, sort_keys=True).encode()
        ).hexdigest()
    if actual != compatibility["flywayHistorySha256"]:
        raise ValueError(
            "Actual Flyway history differs from the tested compatibility report"
        )


def verify_configuration(cluster, failed, target):
    obj = json.loads(
        command(cluster.prefix + ["get", "configmap", "editor-config", "-o", "json"])
    )
    actual = hashlib.sha256(
        json.dumps(obj["data"], sort_keys=True).encode()
    ).hexdigest()
    field = "previousConfigSha256" if target == "previous" else "desiredConfigSha256"
    if failed.get(field) != actual:
        raise ValueError(
            "Live configuration differs from the hash-bound recovery target"
        )
    return actual


def approve(plan, fresh):
    if plan.get("approved") is not True or {
        key: value
        for key, value in plan.items()
        if key not in ("approved", "expiresAt")
    } != {
        key: value
        for key, value in fresh.items()
        if key not in ("approved", "expiresAt")
    }:
        raise ValueError(
            "Reviewed approval differs from the freshly inspected recovery plan"
        )
    expiry = dt.datetime.fromisoformat(plan["expiresAt"])
    now = dt.datetime.now(dt.timezone.utc)
    if expiry.tzinfo is None or not now < expiry <= now + dt.timedelta(hours=1):
        raise ValueError("Recovery approval expired or has an excessive lifetime")


def require_frozen_workflow(repository):
    import os

    if "https://github.com/" + os.environ.get("GITHUB_REPOSITORY", "") != repository:
        raise ValueError(
            "Recovery Actions repository must match the reviewed repository"
        )
    actions = Actions()
    workflow = actions.request("actions/workflows/gke-build-deploy.yml")
    if workflow.get("state") != "disabled_manually":
        raise ValueError("Temporarily disable Build & deploy before operator recovery")
    if any(
        row.get("path") in WORKFLOWS and row.get("status") != "completed"
        for row in actions.pages("actions/runs?branch=main", "workflow_runs")
    ):
        raise ValueError(
            "Wait for every existing deployment run to finish before operator recovery"
        )


def execute(cluster, plan, live):
    patches = {}
    for name in plan["selectedServices"]:
        obj = live[name]
        patches[name] = [
            {
                "op": "test",
                "path": "/metadata/resourceVersion",
                "value": obj["metadata"]["resourceVersion"],
            },
            {"op": "test", "path": "/metadata/uid", "value": obj["metadata"]["uid"]},
            {
                "op": "test",
                "path": "/spec/template/spec/containers/0/image",
                "value": obj["spec"]["template"]["spec"]["containers"][0]["image"],
            },
            {
                "op": "replace",
                "path": "/spec/template/spec/containers/0/image",
                "value": plan["targetImages"][name],
            },
        ]
        command(
            cluster.prefix
            + [
                "patch",
                "deployment",
                name,
                "--type=json",
                "-p",
                json.dumps(patches[name]),
                "--dry-run=server",
                "-o",
                "name",
            ]
        )
    for name, patch in patches.items():
        command(
            cluster.prefix
            + [
                "patch",
                "deployment",
                name,
                "--type=json",
                "-p",
                json.dumps(patch),
                "-o",
                "name",
            ]
        )
        command(
            cluster.prefix
            + ["rollout", "status", "deployment/" + name, "--timeout=360s"]
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["plan", "execute"])
    for key in ("failed", "baseline", "before", "compatibility", "output"):
        parser.add_argument("--" + key, type=Path, required=True)
    for key in ("context", "project", "region", "repository"):
        parser.add_argument("--" + key, required=True)
    parser.add_argument("--approval", type=Path)
    parser.add_argument("--mysql-defaults", type=Path, required=True)
    parser.add_argument("--target", choices=["previous", "current"], default="previous")
    args = parser.parse_args()
    failed, baseline, before, compatibility = [
        read(getattr(args, key))
        for key in ("failed", "baseline", "before", "compatibility")
    ]
    validate_states(failed, baseline, args.project, args.region, args.repository)
    source = Source(defaults=args.mysql_defaults)
    verify_schema(source, compatibility)
    cluster = Cluster(args.context)
    configuration_hash = verify_configuration(cluster, failed, args.target)
    live = cluster.inventory()
    plan = make_plan(
        args.context, failed, baseline, before, live, compatibility, target=args.target
    )
    target_state = baseline if args.target == "previous" else failed
    plan["targetImages"] = target_state["images"]
    args.output.mkdir(parents=True, exist_ok=True)
    if args.action == "plan":
        (args.output / "recovery-plan.json").write_text(
            json.dumps(plan, indent=2) + "\n"
        )
        print("Recovery plan written; no cluster mutation performed")
        return
    if not args.approval:
        raise ValueError("Execution requires the reviewed --approval file")
    require_frozen_workflow(args.repository)
    traffic = TrafficMonitor.environment(str(args.output / "traffic.json"))
    # DDL is fenced as well as the operator's exclusive deployment window.
    with source.ddl_fence():
        verify_schema(source, compatibility)
        verify_configuration(cluster, failed, args.target)
        fresh_live = cluster.inventory()
        fresh = make_plan(
            args.context,
            failed,
            baseline,
            before,
            fresh_live,
            compatibility,
            target=args.target,
        )
        fresh["targetImages"] = target_state["images"]
        approve(read(args.approval), fresh)
        (args.output / "recovery-attempt.json").write_text(
            json.dumps(
                {
                    "status": "PENDING",
                    "planSha256": fingerprint(fresh),
                    "selectedServices": fresh["selectedServices"],
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        execute(cluster, fresh, fresh_live)

        def query(*parts):
            return json.loads(command(cluster.prefix + [*parts, "-o", "json"]))

        with (
            traffic,
            AvailabilityMonitor(
                NAMES,
                query=query,
                origin=traffic.owner.origin,
                report=str(args.output / "availability.json"),
            ) as availability,
        ):
            deadline = time.monotonic() + 60
            drain_deadline = time.monotonic() + 420
            while True:
                traffic.require_healthy()
                availability.require_healthy()
                pods = query("get", "pods").get("items", [])
                draining = any(
                    pod["metadata"].get("deletionTimestamp")
                    and pod["metadata"].get("labels", {}).get("app") in NAMES
                    for pod in pods
                )
                if time.monotonic() >= deadline and not draining:
                    break
                if time.monotonic() > drain_deadline:
                    raise ValueError("Recovery Pods did not finish draining")
                time.sleep(1)
        if availability.failures:
            raise ValueError("Recovery availability observer failed during shutdown")
    after = bounded(cluster.inventory())
    from routine_release import validate_live

    validate_live(
        target_state,
        {
            "deployments": cluster.inventory(),
            "pods": json.loads(command(cluster.prefix + ["get", "pods", "-o", "json"]))[
                "items"
            ],
        },
    )
    for name in NAMES:
        if after[name]["image"] != target_state["images"][name]:
            raise ValueError("Partial recovery remains PENDING; inspect live state")
    verify_configuration(cluster, failed, args.target)
    make_plan(
        args.context,
        failed,
        baseline,
        before,
        cluster.inventory(),
        compatibility,
        target=args.target,
    )
    state = copy.deepcopy(target_state)
    state["rolloutStatus"] = "PASS"
    state["recoveryOf"] = {
        "failedStateSha256": fingerprint(failed),
        "runUrl": failed["runUrl"],
        "decision": (
            "operator-approved-image-rollback"
            if args.target == "previous"
            else "operator-approved-roll-forward"
        ),
        "compatibilitySha256": fingerprint(compatibility),
        "afterSha256": fingerprint(after),
        "trafficSha256": fingerprint(read(args.output / "traffic.json")),
        "configurationSha256": configuration_hash,
        "verifiedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    (args.output / "recovered-environment-state.json").write_text(
        json.dumps(state, indent=2) + "\n"
    )
    (args.output / "recovery-attempt.json").write_text(
        json.dumps({"status": "PASS", "stateSha256": fingerprint(state)}, indent=2)
        + "\n",
        encoding="utf-8",
    )
    print(
        "Image recovery completed. SQL unchanged. Run authenticated/consumer checks before approving baseline reconciliation."
    )


if __name__ == "__main__":
    main()
