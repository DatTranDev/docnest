"""Archive immutable Actions evidence independently of deployment's 90-day retention."""

import argparse
import json
import os
from pathlib import Path
import re
import tempfile

from deployment_state import Actions, WORKFLOWS, read_state
from digest_manifest import NAMES as SERVICES
from online_backup import encrypt, run
from release_manifest import validate_provenance

NAMES = {
    "deployment-evidence",
    "cloud-image-digests",
    "cloud-image-scan-evidence",
    "application-acceptance-evidence",
}


def evidence_sources(state, repository, current):
    if set(state.get("images", {})) != set(SERVICES):
        raise ValueError("Complete six-image state required for evidence retention")
    validate_provenance(state.get("imageProvenance"), state["images"], repository)
    required = {current: {"deployment-evidence"}}
    for record in state["imageProvenance"].values():
        source = record["runUrl"].rsplit("/", 1)[1]
        required.setdefault(source, set()).update(
            {"cloud-image-digests", "cloud-image-scan-evidence"}
        )
    gate = state.get("acceptanceGate", {})
    if gate:
        if not re.fullmatch(
            re.escape(repository) + r"/actions/runs/[0-9]+", gate.get("runUrl", "")
        ):
            raise ValueError("Acceptance evidence belongs to another repository")
        required.setdefault(gate["runUrl"].rsplit("/", 1)[1], set()).add(
            "application-acceptance-evidence"
        )
    return required


def artifacts_for(actions, run_id):
    artifacts = {}
    for artifact in actions.pages("actions/runs/" + run_id + "/artifacts", "artifacts"):
        name = artifact["name"]
        if (
            name in NAMES
            and not artifact["expired"]
            and artifact["id"] > artifacts.get(name, {}).get("id", 0)
        ):
            artifacts[name] = artifact
    return artifacts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--destination-prefix", required=True)
    parser.add_argument("--recipient", required=True)
    parser.add_argument("--age", default="age")
    args = parser.parse_args()
    if not args.run_id.isdigit() or not re.fullmatch(
        r"gs://[a-z0-9][a-z0-9._-]+/release-evidence", args.destination_prefix
    ):
        raise ValueError("Explicit run ID and reviewed evidence bucket prefix required")
    actions = Actions()
    release = actions.request("actions/runs/" + args.run_id)
    if (
        release.get("path") != ".github/workflows/gke-build-deploy.yml"
        or release.get("head_branch") != "main"
        or release.get("event") != "workflow_dispatch"
        or release.get("conclusion") != "success"
    ):
        raise ValueError(
            "Only successful protected main deployments can be archived as approved"
        )
    artifacts = artifacts_for(actions, args.run_id)
    if "deployment-evidence" not in artifacts:
        raise ValueError("Deployment evidence has expired or is missing")
    deployment = actions.request(
        f"actions/artifacts/{artifacts['deployment-evidence']['id']}/zip", binary=True
    )
    state = read_state(deployment)
    if (
        state is None
        or state.get("rolloutStatus") != "PASS"
        or state.get("commit") != release["head_sha"]
    ):
        raise ValueError(
            "Deployment evidence is incomplete or belongs to another commit"
        )
    sources = evidence_sources(
        state, "https://github.com/" + os.environ["GITHUB_REPOSITORY"], args.run_id
    )
    with tempfile.TemporaryDirectory(prefix="docsnest-release-archive-") as temporary:
        directory = Path(temporary) / "evidence"
        directory.mkdir(mode=0o700)
        index = {}
        for source, required in sources.items():
            if source != args.run_id:
                previous = actions.request("actions/runs/" + source)
                if (
                    previous.get("path") not in WORKFLOWS
                    or previous.get("head_branch") != "main"
                    or previous.get("event") != "workflow_dispatch"
                    or previous.get("conclusion") != "success"
                ):
                    raise ValueError(
                        "Referenced evidence is not an approved main release"
                    )
            selected = (
                artifacts if source == args.run_id else artifacts_for(actions, source)
            )
            if not required.issubset(selected):
                raise ValueError(
                    "Referenced scan/acceptance evidence expired or is missing"
                )
            destination = directory / source
            destination.mkdir(mode=0o700)
            index[source] = {}
            for name in (selected if source == args.run_id else required):
                artifact = selected[name]
                data = (
                    deployment
                    if source == args.run_id and name == "deployment-evidence"
                    else actions.request(
                        f"actions/artifacts/{artifact['id']}/zip", binary=True
                    )
                )
                (destination / (name + ".zip")).write_bytes(data)
                index[source][name] = artifact["id"]
        (directory / "archive-index.json").write_text(
            json.dumps(
                {
                    "runId": args.run_id,
                    "commit": release["head_sha"],
                    "artifactIdsBySourceRun": index,
                },
                indent=2,
            )
        )
        output = Path(temporary) / (args.run_id + ".tar.age")
        encrypt(directory, output, args.recipient, args.age)
        run(
            [
                "gcloud",
                "storage",
                "cp",
                "--project",
                args.project,
                "--if-generation-match=0",
                str(output),
                args.destination_prefix + "/" + output.name,
            ]
        )
    print("PASS encrypted immutable release evidence archive")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit(
            "Release evidence archive failed; protected URLs/output withheld"
        ) from None
