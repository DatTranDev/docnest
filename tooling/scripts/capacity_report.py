"""Read-only conservative CPU/memory budget; does not scale, provision or prove HA."""

import argparse
from decimal import Decimal
import json
from pathlib import Path
import re
import subprocess

import yaml

from digest_manifest import NAMES

ROOT = Path(__file__).resolve().parents[2]


def quantity(value):
    match = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)([A-Za-z]*)", str(value))
    factors = {
        "": 1,
        "n": Decimal("0.000000001"),
        "u": Decimal("0.000001"),
        "m": Decimal("0.001"),
        "k": 1000,
        "K": 1000,
        "M": 1000000,
        "G": 1000000000,
        "Ki": 1024,
        "Mi": 1024**2,
        "Gi": 1024**3,
        "Ti": 1024**4,
    }
    if not match or match[2] not in factors:
        raise ValueError("Unsupported resource quantity; do not infer capacity")
    return Decimal(match[1]) * factors[match[2]]


def resources(pod):
    # Sum init as well as app containers: deliberately conservative for sequential init.
    containers = pod.get("containers", []) + pod.get("initContainers", [])
    return {
        key: sum(
            (
                quantity(container.get("resources", {}).get("requests", {}).get(key, 0))
                for container in containers
            ),
            quantity(pod.get("overhead", {}).get(key, 0)),
        )
        for key in ("cpu", "memory")
    }


def command(args):
    result = subprocess.run(
        args, capture_output=True, text=True, encoding="utf-8", timeout=60
    )
    if result.returncode:
        raise ValueError(
            "Read-only capacity inventory unavailable; protected output withheld"
        )
    return result.stdout


def report(nodes, pods, applications):
    ready = [
        node
        for node in nodes["items"]
        if not node["spec"].get("unschedulable", False)
        and any(
            condition["type"] == "Ready" and condition["status"] == "True"
            for condition in node["status"].get("conditions", [])
        )
    ]
    allocatable = {
        key: sum(
            (quantity(node["status"]["allocatable"][key]) for node in ready), Decimal(0)
        )
        for key in ("cpu", "memory")
    }
    other = {key: Decimal(0) for key in allocatable}
    for pod in pods["items"]:
        if pod.get("status", {}).get("phase") in ("Succeeded", "Failed"):
            continue
        if (
            pod["metadata"].get("namespace") == "editor-lab"
            and pod["metadata"].get("labels", {}).get("app") in NAMES
        ):
            continue
        requested = resources(pod["spec"])
        for key in other:
            other[key] += requested[key]
    steady, peak = ({key: Decimal(0) for key in other} for _ in range(2))
    for obj in applications:
        spec = obj["spec"]
        requested = resources(spec["template"]["spec"])
        replicas = spec.get("replicas", 1)
        for key in steady:
            steady[key] += requested[key] * replicas
            peak[key] += requested[key] * (2 * replicas + 1)
    fits = bool(ready) and all(
        other[key] + peak[key] <= allocatable[key] for key in peak
    )
    display = lambda values: {
        "cpuCores": round(float(values["cpu"]), 3),
        "memoryMiB": round(float(values["memory"] / 1024**2), 2),
    }
    return {
        "capacityStatus": (
            "FITS_CONSERVATIVE_REQUEST_BOUND"
            if fits
            else "INSUFFICIENT_CONSERVATIVE_REQUEST_BOUND"
        ),
        "readySchedulableNodes": len(ready),
        "criticalReplicasCanUseDistinctNodes": len(ready) >= 2,
        "allocatable": display(allocatable),
        "otherPodRequests": display(other),
        "plannedApplicationRequests": display(steady),
        "conservativeApplicationPeak": display(peak),
        "assumption": "All selected applications retain previous terminating replicas plus surge concurrently; init requests are summed",
        "limits": "Not scheduler/taint/affinity simulation, actual utilization, surge benchmark, infrastructure HA or cost approval",
        "provisioning": "NOT_PERFORMED",
        "budgetApproval": "PENDING",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--context", required=True)
    parser.add_argument("--profile", choices=["lab", "availability"], default="lab")
    parser.add_argument(
        "--output", type=Path, default=ROOT / "testing/reports/gke-capacity.json"
    )
    args = parser.parse_args()
    prefix = ["kubectl", "--context", args.context, "--request-timeout=30s"]
    nodes = json.loads(command([*prefix, "get", "nodes", "-o", "json"]))
    pods = json.loads(
        command([*prefix, "get", "pods", "--all-namespaces", "-o", "json"])
    )
    objects = list(
        yaml.safe_load_all(
            command(
                [
                    "kubectl",
                    "kustomize",
                    str(ROOT / "infra/k8s/overlays" / args.profile),
                ]
            )
        )
    )
    applications = [
        obj
        for obj in objects
        if obj and obj["kind"] == "Deployment" and obj["metadata"]["name"] in NAMES
    ]
    if len(applications) != len(NAMES):
        raise ValueError("Capacity render must contain all six applications")
    value = report(nodes, pods, applications)
    value["profile"] = args.profile
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(value))


if __name__ == "__main__":
    main()
