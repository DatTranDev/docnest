"""Validate shutdown budgets and the existing GKE backend; never applies infrastructure."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def policy():
    value = json.loads(
        (ROOT / "infra/k8s/drain-policy.json").read_text(encoding="utf-8")
    )
    if value["schemaVersion"] != 1 or any(
        type(number) is not int or number < 1 for number in value.values()
    ):
        raise ValueError("Invalid shutdown budget")
    if (
        value["backendDrainSeconds"] < value["requestTimeoutSeconds"]
        or value["webPreStopSeconds"]
        < value["backendDrainSeconds"] + value["negDetachBudgetSeconds"]
        or value["webTerminationGraceSeconds"]
        < value["webPreStopSeconds"]
        + value["applicationShutdownSeconds"]
        + value["shutdownMarginSeconds"]
    ):
        raise ValueError("Inconsistent NEG, request and application shutdown budgets")
    return value


def validate_backend(backend):
    expected = policy()
    spec = backend.get("spec", {})
    if (
        spec.get("timeoutSec") != expected["requestTimeoutSeconds"]
        or spec.get("connectionDraining", {}).get("drainingTimeoutSec")
        != expected["backendDrainSeconds"]
    ):
        raise ValueError(
            "Existing editor-web BackendConfig differs from drain-policy.json; "
            "operator must reconcile and test ingress before application rollout"
        )


def validate_web(deployment):
    expected = policy()
    spec = deployment["spec"]["template"]["spec"]
    command = (
        spec["containers"][0]
        .get("lifecycle", {})
        .get("preStop", {})
        .get("exec", {})
        .get("command")
    )
    if (
        command != ["/bin/sh", "-c", "sleep " + str(expected["webPreStopSeconds"])]
        or spec.get("terminationGracePeriodSeconds")
        != expected["webTerminationGraceSeconds"]
    ):
        raise ValueError("Web template does not satisfy the reviewed drain budget")
