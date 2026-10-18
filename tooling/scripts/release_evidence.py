"""Verify actual release scope from bounded before/after artifacts, not source assertions."""

import argparse
import json
from pathlib import Path

from digest_manifest import NAMES
from routine_rollout import verify_unrelated


def verify(directory, expected=None, source_service=None):
    directory = Path(directory)
    read = lambda name: json.loads((directory / name).read_text(encoding="utf-8"))
    before, after, state = [
        read(name) for name in ("before.json", "after.json", "environment-state.json")
    ]
    selected = state.get("selectedServices")
    if (
        state.get("rolloutStatus") != "PASS"
        or not isinstance(selected, list)
        or not set(selected).issubset(NAMES)
        or len(selected) != len(set(selected))
    ):
        raise ValueError("Only complete successful rollout evidence can pass")
    if expected is not None and set(expected) != set(selected):
        raise ValueError("Actual release scope differs from the expected proof")
    verify_unrelated(before, after, selected)
    for name in NAMES:
        if after["deployments"][name]["image"] != state["images"][name]:
            raise ValueError("Final image differs from approved state")
    availability = read("availability.json")
    if (
        not availability.get("samples")
        or availability.get("failures")
        or any(
            set(sample["readyEndpoints"]) != set(NAMES)
            or any(count < 1 for count in sample["readyEndpoints"].values())
            for sample in availability["samples"]
        )
    ):
        raise ValueError("Availability evidence is missing or failed")
    build_only = state.get("acceptanceGate", {}).get("profile") == "build-only-v1"
    if build_only:
        if state["acceptanceGate"].get("tests") != "NOT_RUN":
            raise ValueError("Build-only evidence must declare tests NOT_RUN")
    else:
        traffic = read("traffic.json")
        if (
            traffic.get("status") != "PASS"
            or traffic.get("failedRequests") != 0
            or traffic.get("committedVersions", 0) < 1
            or traffic.get("verifiedExports", 0) < 1
        ):
            raise ValueError("Authenticated application evidence is missing or failed")
    affected = read("affected.json")
    if source_service:
        if (
            affected.get("images") != [source_service]
            or affected.get("migrations") != []
            or selected != [source_service]
            or before["deployments"][source_service]["image"]
            == state["images"][source_service]
        ):
            raise ValueError(
                "Single-service source proof requires only its new image and no migration"
            )
        if [row for row in before["pods"] if row[0] == source_service] == [
            row for row in after["pods"] if row[0] == source_service
        ]:
            raise ValueError("The selected source service did not replace its Pods")
    return {
        "status": "PASS",
        "selectedServices": selected,
        "unrelatedServicesPreserved": [name for name in NAMES if name not in selected],
        "scope": (
            "Build-only release and recorded rollout readiness; functional tests NOT_RUN"
            if build_only
            else "Recorded rollout and synthetic HTTP; separate GKE/CRDT/worker acceptance still required"
        ),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--expect", choices=[*NAMES, "no-op"])
    parser.add_argument("--source-service", choices=NAMES)
    args = parser.parse_args()
    expected = (
        None
        if args.expect is None
        else ([] if args.expect == "no-op" else [args.expect])
    )
    result = verify(args.directory, expected, args.source_service)
    (args.directory / "scope-proof.json").write_text(
        json.dumps(result, indent=2) + "\n"
    )
    print("PASS actual release scope and declared verification profile")


if __name__ == "__main__":
    main()
