"""Serial, observed application-only rollout. Does not scale, provision or roll back SQL."""

import json
import os
from pathlib import Path
import subprocess
import threading
import time
import urllib.request

import yaml

from digest_manifest import NAMES
from routine_release import (
    configuration_scope,
    evidence_inventory,
    inventory,
    kubectl,
    validate_live,
    write_json,
)


class AvailabilityMonitor:
    def __init__(self, names):
        self.names = names
        self.stop = threading.Event()
        self.failures = []
        self.samples = []
        self.thread = threading.Thread(target=self.observe, daemon=True)

    def sample(self):
        counts = {}
        for name in self.names:
            slices = kubectl(
                "get", "endpointslices", "-l", "kubernetes.io/service-name=" + name
            )
            counts[name] = sum(
                len(endpoint.get("addresses", []))
                for item in slices.get("items", [])
                for endpoint in item.get("endpoints", [])
                if endpoint.get("conditions", {}).get("ready") is True
                and not endpoint.get("conditions", {}).get("terminating", False)
            )
            if counts[name] < 1:
                raise ValueError("No serving endpoint: " + name)
        with urllib.request.urlopen(
            os.environ["ORIGIN"] + "/healthz", timeout=5
        ) as response:
            if response.status != 200:
                raise ValueError("Public readiness failed")
        self.samples.append(
            {
                "elapsedSeconds": round(time.monotonic() - self.started, 2),
                "readyEndpoints": counts,
            }
        )

    def observe(self):
        while not self.stop.wait(1):
            try:
                self.sample()
            except Exception:
                self.failures.append("Endpoint or public readiness observation failed")
                return

    def __enter__(self):
        self.started = time.monotonic()
        self.sample()
        self.thread.start()
        return self

    def __exit__(self, *unused):
        self.stop.set()
        self.thread.join(timeout=40)
        if self.thread.is_alive():
            self.failures.append("Readiness observer did not finish")
        write_json(
            "deployment-evidence/availability.json",
            {
                "samples": self.samples,
                "failures": self.failures,
                "scope": "Sampled EndpointSlice availability and HTTPS readiness; not authenticated feature, latency or continuous-traffic acceptance",
            },
        )

    def require_healthy(self):
        if self.failures:
            raise ValueError(
                "Rollout stopped after a readiness observation failure; review evidence"
            )


def run_stage(command, stages, name):
    start = time.monotonic()
    result = subprocess.run(command, timeout=420, capture_output=True, text=True)
    stages.append(
        {
            "stage": name,
            "durationSeconds": round(time.monotonic() - start, 2),
            "exitCode": result.returncode,
        }
    )
    write_json("deployment-evidence/stages.json", stages)
    if result.returncode:
        # Do not retain arbitrary API errors/payloads or migration logs in artifacts.
        raise ValueError("Deployment stage failed: " + name)


def verify_unrelated(before, after, selected):
    for name in NAMES:
        if name not in selected:
            if before["deployments"][name] != after["deployments"][name]:
                raise ValueError("Unrelated Deployment changed: " + name)
            if [row for row in before["pods"] if row[0] == name] != [
                row for row in after["pods"] if row[0] == name
            ]:
                raise ValueError("Unrelated application Pod UIDs changed: " + name)


def main():
    affected = json.loads(Path("affected.json").read_text(encoding="utf-8"))
    state = json.loads(
        Path("deployment-evidence/environment-state.json").read_text(encoding="utf-8")
    )
    before = json.loads(
        Path("deployment-evidence/before.json").read_text(encoding="utf-8")
    )
    applications = [
        obj
        for obj in yaml.safe_load_all(
            Path("cloud-render/applications.yaml").read_text(encoding="utf-8")
        )
        if obj
    ]
    migrations = [
        obj
        for obj in yaml.safe_load_all(
            Path("cloud-render/migrations.yaml").read_text(encoding="utf-8")
        )
        if obj
    ]
    configs = list(
        yaml.safe_load_all(
            Path("cloud-render/bootstrap.yaml").read_text(encoding="utf-8")
        )
    )
    config = next(
        obj
        for obj in configs
        if obj["kind"] == "ConfigMap" and obj["metadata"]["name"] == "editor-config"
    )
    live = inventory()
    validate_live({"images": state["previousImages"]}, live)
    verify_unrelated(before, evidence_inventory(live), [])
    selected = configuration_scope(
        config["data"],
        kubectl("get", "configmap", "editor-config")["data"],
        affected,
        live,
        os.environ.get("TRUSTED_PROXY_CIDRS", ""),
    )
    if set(obj["metadata"]["name"] for obj in applications) != set(NAMES):
        raise ValueError("Renderer must provide the complete application inventory")
    applications = [obj for obj in applications if obj["metadata"]["name"] in selected]
    expected_jobs = {
        "migrate-" + name + "-" + os.environ["RELEASE_ID"]
        for name in affected["migrations"]
    }
    if {obj["metadata"]["name"] for obj in migrations} != expected_jobs:
        raise ValueError("Rendered migration scope differs from reviewed impact")
    jobs = kubectl("get", "jobs", "-l", "application=text-editor")
    if any(obj.get("status", {}).get("active", 0) for obj in jobs.get("items", [])):
        raise ValueError("Another application migration is active")
    for obj in applications:
        if obj["metadata"]["name"] == "web":
            for entry in obj["spec"]["template"]["spec"]["containers"][0]["env"]:
                if entry["name"] == "TRUSTED_PROXY_CIDRS":
                    entry["value"] = os.environ.get("TRUSTED_PROXY_CIDRS", "")
    stages = []
    with AvailabilityMonitor(NAMES) as observer:
        config_path = Path("cloud-render/selected-config.yaml")
        config_path.write_text(
            yaml.safe_dump(config, sort_keys=False), encoding="utf-8"
        )
        run_stage(
            ["kubectl", "apply", "--dry-run=server", "-f", str(config_path)],
            stages,
            "validate-config",
        )
        for obj in migrations + applications:
            target = Path("cloud-render") / (obj["metadata"]["name"] + ".yaml")
            if obj["kind"] == "Deployment":
                if obj["spec"].get("strategy", {}).get("rollingUpdate") != {
                    "maxSurge": 1,
                    "maxUnavailable": 0,
                }:
                    raise ValueError(
                        "Routine releases require availability-preserving rolling updates"
                    )
                obj["spec"]["replicas"] = live["deployments"][obj["metadata"]["name"]][
                    "spec"
                ].get("replicas", 1)
            target.write_text(yaml.safe_dump(obj, sort_keys=False), encoding="utf-8")
            run_stage(
                ["kubectl", "apply", "--dry-run=server", "-f", str(target)],
                stages,
                "validate-" + obj["metadata"]["name"],
            )
        # Every server dry-run must succeed before config, jobs or Pod templates change.
        observer.require_healthy()
        if selected:
            state["mutationStarted"] = True
            write_json("deployment-evidence/environment-state.json", state)
            run_stage(
                ["kubectl", "apply", "-f", str(config_path)], stages, "apply-config"
            )
        for obj in migrations:
            name = obj["metadata"]["name"]
            observer.require_healthy()
            # Unique release names; never delete a different release's migration Job.
            run_stage(
                ["kubectl", "create", "-f", "cloud-render/" + name + ".yaml"],
                stages,
                name,
            )
            run_stage(
                [
                    "kubectl",
                    "-n",
                    "editor-lab",
                    "wait",
                    "--for=condition=complete",
                    "--timeout=300s",
                    "job/" + name,
                ],
                stages,
                "wait-" + name,
            )
        # NAMES is backend-first, Web-last. Apply only selected desired state.
        for name in NAMES:
            if name not in selected:
                continue
            observer.require_healthy()
            run_stage(
                ["kubectl", "apply", "-f", "cloud-render/" + name + ".yaml"],
                stages,
                "apply-" + name,
            )
            run_stage(
                [
                    "kubectl",
                    "-n",
                    "editor-lab",
                    "rollout",
                    "status",
                    "deployment/" + name,
                    "--timeout=300s",
                ],
                stages,
                "ready-" + name,
            )
            observer.sample()
        # rollout status can finish while old Pods are still in their preStop/drain period.
        drain_start = time.monotonic()
        while True:
            after = inventory()
            draining = any(
                pod["metadata"].get("deletionTimestamp")
                and pod["metadata"].get("labels", {}).get("app") in selected
                for pod in after["pods"]
            )
            if not draining:
                break
            observer.require_healthy()
            if time.monotonic() - drain_start > 200:
                raise ValueError("Old application Pods did not finish draining")
            time.sleep(1)
        stages.append(
            {
                "stage": "wait-old-pod-drain",
                "durationSeconds": round(time.monotonic() - drain_start, 2),
                "exitCode": 0,
            }
        )
        write_json("deployment-evidence/stages.json", stages)
        validate_live(state, after)
        safe_after = evidence_inventory(after)
        verify_unrelated(before, safe_after, selected)
        write_json("deployment-evidence/after.json", safe_after)
        observer.require_healthy()
    if observer.failures:
        raise ValueError(
            "Rollout observation failed; environment state is not approved"
        )
    state["selectedServices"] = selected
    state["rolloutStatus"] = "PASS"
    write_json("deployment-evidence/environment-state.json", state)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
            summary.write(
                "Rolling release passed. Updated services: "
                + (", ".join(selected) or "none; application state is unchanged")
                + ". Deployment state and readiness samples: deployment-evidence artifact.\n"
            )
    print(
        "Selected rollout completed; review environment-state and observation evidence"
    )


if __name__ == "__main__":
    main()
