"""Protected routine-release planning and preflight; never pauses applications."""

import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

from detect_affected import resolve, selection
from digest_manifest import NAMES, validate_manifest
from release_manifest import merge_state, validate_provenance
from service_config import config_hash


def command(*args):
    return subprocess.check_output(list(args), text=True, encoding="utf-8", timeout=30)


def kubectl(*args):
    return json.loads(command("kubectl", "-n", "editor-lab", *args, "-o", "json"))


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def approved_state():
    state = json.loads(os.environ["STATE_JSON"])
    validate_manifest(state.get("images"), os.environ["PROJECT"], os.environ["REGION"])
    validate_provenance(
        state.get("imageProvenance"), state["images"], os.environ["REPOSITORY_URL"]
    )
    if (
        state.get("rolloutStatus") != "PASS"
        or state.get("schemaVersion") != 2
        or not re.fullmatch(r"[a-f0-9]{40}", state.get("commit", ""))
    ):
        raise ValueError("A reviewed full V2 environment state is required")
    subprocess.run(
        [
            "git",
            "merge-base",
            "--is-ancestor",
            state["commit"],
            os.environ["GITHUB_SHA"],
        ],
        check=True,
    )
    return state


def plan(state):
    impact = resolve(state["commit"], os.environ["GITHUB_SHA"], merge_base=False)
    extra = selection(json.loads(os.environ.get("EXTRA_SERVICES", "[]")))
    impact["images"] = selection(list(set(impact["images"]) | set(extra)))
    impact["applications"] = selection(list(set(impact["applications"]) | set(extra)))
    if impact["coordinated"]:
        raise ValueError(
            "Shared protocol/native changes require the coordinated maintenance release"
        )
    return impact


def inventory():
    deployments = {name: kubectl("get", "deployment", name) for name in NAMES}
    pods = kubectl("get", "pods").get("items", [])
    return {"deployments": deployments, "pods": pods}


def evidence_inventory(live):
    return {
        "deployments": {
            name: {
                "uid": obj["metadata"]["uid"],
                "templateSha256": hashlib.sha256(
                    json.dumps(obj["spec"]["template"], sort_keys=True).encode()
                ).hexdigest(),
                "replicas": obj["spec"].get("replicas", 1),
                "image": obj["spec"]["template"]["spec"]["containers"][0]["image"],
            }
            for name, obj in live["deployments"].items()
        },
        "pods": sorted(
            (pod["metadata"].get("labels", {}).get("app", ""), pod["metadata"]["uid"])
            for pod in live["pods"]
            if pod["metadata"].get("labels", {}).get("app") in NAMES
        ),
    }


def validate_live(state, live):
    if any(
        pod["metadata"].get("deletionTimestamp")
        for pod in live["pods"]
        if pod["metadata"].get("labels", {}).get("app") in NAMES
    ):
        raise ValueError("Wait for previous application Pods to finish draining")
    for name in NAMES:
        obj = live["deployments"][name]
        spec, status = obj["spec"], obj.get("status", {})
        containers = spec["template"]["spec"]["containers"]
        if len(containers) != 1 or containers[0]["image"] != state["images"][name]:
            raise ValueError("Live image differs from approved environment: " + name)
        desired = spec.get("replicas", 1)
        if (
            desired < 1
            or status.get("readyReplicas", 0) < desired
            or status.get("availableReplicas", 0) < desired
            or status.get("updatedReplicas", 0) != desired
            or status.get("replicas", 0) != desired
            or status.get("observedGeneration", 0) != obj["metadata"]["generation"]
            or "docsnest.dattrandev.id.vn/backup-run"
            in obj["metadata"].get("annotations", {})
        ):
            raise ValueError(
                "Applications must be healthy, stable and outside maintenance: " + name
            )


def validate_recovery(metadata, now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    updated = datetime.datetime.fromisoformat(
        metadata.get("update_time", metadata.get("updated", "")).replace("Z", "+00:00")
    )
    age = (now - updated).total_seconds()
    if (
        int(metadata.get("size", 0)) <= 0
        or not metadata.get("generation")
        or not 0 <= age <= 86400
    ):
        raise ValueError(
            "Recovery object must be nonempty, generation-pinned and at most 24 hours old"
        )


def validate_acceptance(impact, environment=None):
    environment = os.environ if environment is None else environment
    if environment.get("ROUTINE_RELEASE_ENABLED") != "true":
        raise ValueError(
            "Routine rollout acceptance/capacity/worker gate is not enabled"
        )
    for key in ("ROLLOUT_ACCEPTANCE_RUN", "RESTORE_DRILL_RUN"):
        if not re.fullmatch(
            re.escape(environment["REPOSITORY_URL"]) + r"/actions/runs/[0-9]+",
            environment.get(key, ""),
        ):
            raise ValueError(
                "Reviewed runtime and restore evidence is required: " + key
            )
    if impact["migrations"] and environment.get("MIGRATIONS_COMPATIBLE") != "true":
        raise ValueError(
            "New migrations need explicit mixed-version expand-only review"
        )


def prepare(state, impact):
    validate_acceptance(impact)
    reference, bucket = os.environ["BACKUP_REFERENCE"], os.environ["BACKUPS"]
    prefix = "gs://" + bucket + "/"
    if not reference.startswith(prefix) or not re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9._/-]{0,512}\.(age|gpg)", reference[len(prefix) :]
    ):
        raise ValueError("A scoped encrypted recovery object is required")
    metadata = json.loads(
        command("gcloud", "storage", "objects", "describe", reference, "--format=json")
    )
    validate_recovery(metadata)
    write_json(
        "deployment-evidence/recovery-object.json",
        {
            key: metadata.get(key)
            for key in ("generation", "size", "update_time", "updated")
        },
    )
    build_json = os.environ.get("BUILD_MANIFEST", "")
    build = (
        json.loads(build_json)
        if build_json
        else {
            "schemaVersion": 2,
            "nativeFormatVersion": 6,
            "environment": "cloud-gke",
            "ref": "refs/heads/main",
            "googleClientId": state.get("googleClientId", ""),
            "commit": os.environ["GITHUB_SHA"],
            "runUrl": os.environ["RUN_URL"],
            "images": {},
            "imageProvenance": {},
        }
    )
    if set(build["images"]) != set(impact["images"]):
        raise ValueError("Build does not match independently recomputed source impact")
    merged = merge_state(
        state,
        build,
        project=os.environ["PROJECT"],
        region=os.environ["REGION"],
        repository=os.environ["REPOSITORY_URL"],
        commit=os.environ["GITHUB_SHA"],
        run_url=os.environ["RUN_URL"],
    )
    if merged.get("googleClientId") != os.environ.get("GOOGLE_CLIENT_ID", ""):
        raise ValueError("Google build configuration differs from deployed client")
    merged["rolloutStatus"] = "PENDING"
    before = inventory()
    validate_live(state, before)
    write_json("deployment-evidence/before.json", evidence_inventory(before))
    write_json("deployment-evidence/environment-state.json", merged)
    write_json("digests.json", merged["images"])
    write_json("affected.json", impact)


def check_config(config, impact, live):
    for name in NAMES:
        if name not in impact["applications"] and config_hash(
            name, config
        ) != config_hash(name, live):
            raise ValueError(
                "Configuration change affects an unselected application: " + name
            )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["plan", "prepare"])
    args = parser.parse_args()
    state = approved_state()
    impact = plan(state)
    validate_acceptance(impact)
    if args.action == "prepare":
        Path("deployment-evidence").mkdir(exist_ok=True)
        prepare(state, impact)
    elif os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as stream:
            for key in ("images", "applications", "migrations"):
                stream.write(
                    key + "=" + json.dumps(impact[key], separators=(",", ":")) + "\n"
                )
    print(
        "Validated routine release scope:",
        ", ".join(impact["applications"]) or "no application changes",
    )


if __name__ == "__main__":
    main()
