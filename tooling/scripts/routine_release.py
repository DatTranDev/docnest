"""Automatic protected release planning and preflight; never pauses applications."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

from deployment_state import Actions, check_attempt, discover
from detect_affected import resolve
from digest_manifest import NAMES, validate_manifest
from release_manifest import merge_state, validate_provenance
from rolling_policy import validate_compatibility
from service_config import config_hash


def command(*args):
    return subprocess.check_output(list(args), text=True, encoding="utf-8", timeout=30)


def kubectl(*args):
    return json.loads(command("kubectl", "-n", "editor-lab", *args, "-o", "json"))


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def approved_state(state):
    validate_manifest(state.get("images"), os.environ["PROJECT"], os.environ["REGION"])
    validate_provenance(
        state.get("imageProvenance"), state["images"], os.environ["REPOSITORY_URL"]
    )
    if (
        state.get("rolloutStatus") != "PASS"
        or state.get("schemaVersion") != 2
        or state.get("nativeFormatVersion") != 6
        or state.get("environment") != "cloud-gke"
        or state.get("ref") != "refs/heads/main"
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
    impact = resolve(
        state["commit"] if state else None,
        os.environ["GITHUB_SHA"],
        merge_base=False,
    )
    if state and state.get("googleClientId", "") != os.environ.get(
        "GOOGLE_CLIENT_ID", ""
    ):
        for key in ("images", "applications"):
            if "web" not in impact[key]:
                impact[key].append("web")
    validate_compatibility(impact)
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
            [pod["metadata"].get("labels", {}).get("app", ""), pod["metadata"]["uid"]]
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


def prepare(state, impact):
    before = inventory()
    previous = {
        name: before["deployments"][name]["spec"]["template"]["spec"]["containers"][0][
            "image"
        ]
        for name in NAMES
    }
    validate_manifest(previous, os.environ["PROJECT"], os.environ["REGION"])
    validate_live(state or {"images": previous}, before)
    build_json = os.environ.get("BUILD_MANIFEST", "")
    build = (
        json.loads(build_json)
        if build_json
        else {
            "schemaVersion": 2,
            "nativeFormatVersion": 6,
            "environment": "cloud-gke",
            "ref": "refs/heads/main",
            "googleClientId": os.environ.get("GOOGLE_CLIENT_ID", ""),
            "commit": os.environ["GITHUB_SHA"],
            "runUrl": os.environ["RUN_URL"],
            "images": {},
            "imageProvenance": {},
        }
    )
    if set(build["images"]) != set(impact["images"]):
        raise ValueError("Build does not match independently recomputed source impact")
    # First adoption replaces every image with same-run scanned provenance.
    # Live image references are rollback evidence, never fabricated provenance.
    if state is None:
        validate_manifest(build["images"], os.environ["PROJECT"], os.environ["REGION"])
        state = {**build, "rolloutStatus": "PASS"}
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
    merged["mutationStarted"] = False
    merged["previousImages"] = previous
    merged["recoveryStatus"] = (
        "Independent backup/restore verification is not performed by deployment"
    )
    write_json("deployment-evidence/before.json", evidence_inventory(before))
    write_json("deployment-evidence/environment-state.json", merged)
    write_json("digests.json", merged["images"])
    write_json("affected.json", impact)


def configuration_scope(config, current, impact, live, trusted_proxy):
    selected = set(impact["applications"])
    for name in NAMES:
        template = live["deployments"][name]["spec"]["template"]
        annotations = template.get("metadata", {}).get("annotations", {})
        expected = config_hash(name, config)
        if (
            expected != config_hash(name, current)
            or annotations.get("docsnest.dattrandev.id.vn/config-sha256") != expected
        ):
            selected.add(name)
        if name == "web":
            environment = {
                entry["name"]: entry.get("value", "")
                for entry in template["spec"]["containers"][0].get("env", [])
            }
            if environment.get("TRUSTED_PROXY_CIDRS", "") != trusted_proxy:
                selected.add(name)
    return [name for name in NAMES if name in selected]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["plan", "prepare"])
    args = parser.parse_args()
    if os.environ.get("GITHUB_REF") != "refs/heads/main":
        raise ValueError("Only protected main may be released")
    attempt = int(os.environ.get("GITHUB_RUN_ATTEMPT", "1"))
    if args.action == "plan":
        state = discover(Actions(), os.environ["GITHUB_RUN_ID"], attempt)
    else:
        check_attempt(Actions(), os.environ["GITHUB_RUN_ID"], attempt)
        state = json.loads(os.environ["RELEASE_PLAN"])["baseline"]
    if state is not None:
        approved_state(state)
    impact = plan(state)
    if args.action == "prepare":
        Path("deployment-evidence").mkdir(exist_ok=True)
        if json.loads(os.environ["RELEASE_PLAN"])["impact"] != impact:
            raise ValueError("Source impact changed after build planning")
        prepare(state, impact)
    elif os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as stream:
            for key in ("images", "applications", "migrations"):
                stream.write(
                    key + "=" + json.dumps(impact[key], separators=(",", ":")) + "\n"
                )
            stream.write(
                "release_plan="
                + json.dumps(
                    {"baseline": state, "impact": impact}, separators=(",", ":")
                )
                + "\n"
            )
    print(
        "Validated routine release scope:",
        ", ".join(impact["applications"]) or "no application changes",
    )


if __name__ == "__main__":
    main()
