"""Discover bounded deployment evidence from protected repository Actions runs."""

import io
import hashlib
import json
import os
import re
import urllib.error
import urllib.request
import zipfile

WORKFLOWS = {
    ".github/workflows/gke-build-deploy.yml",
    ".github/workflows/gke-selective-deploy.yml",
    ".github/workflows/cloud-deploy.yml",
}
ARTIFACTS = {"deployment-evidence", "selective-deployment-evidence"}
LIMIT = 2 * 1024 * 1024


class ArtifactRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        if not newurl.startswith("https://"):
            raise ValueError("Artifact redirect must use HTTPS")
        redirected = super().redirect_request(request, fp, code, msg, headers, newurl)
        redirected.remove_header("Authorization")
        return redirected


class Actions:
    def __init__(self):
        repository = os.environ["GITHUB_REPOSITORY"]
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
            raise ValueError("Invalid repository")
        self.base = "https://api.github.com/repos/" + repository + "/"
        self.opener = urllib.request.build_opener(ArtifactRedirect())

    def request(self, path, binary=False):
        request = urllib.request.Request(
            self.base + path,
            headers={
                "Authorization": "Bearer " + os.environ["GH_TOKEN"],
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
        try:
            with self.opener.open(request, timeout=30) as response:
                data = response.read(LIMIT + 1)
        except urllib.error.HTTPError as error:
            error.close()
            raise ValueError(
                "Cannot read deployment history from GitHub Actions"
            ) from None
        except Exception:
            # Redirects can contain signed storage URLs. Do not print exceptions.
            raise ValueError(
                "Cannot read deployment history from GitHub Actions"
            ) from None
        if len(data) > LIMIT:
            raise ValueError("Deployment evidence exceeds the size limit")
        return data if binary else json.loads(data)

    def pages(self, path, key):
        for page in range(1, 21):
            separator = "&" if "?" in path else "?"
            rows = self.request(path + separator + f"per_page=100&page={page}")[key]
            yield from rows
            if len(rows) < 100:
                return
        raise ValueError("Deployment history pagination limit reached")


def read_state(archive):
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        entries = [
            entry
            for entry in bundle.infolist()
            if entry.filename == "environment-state.json"
        ]
        if not entries:
            return None
        if len(entries) != 1 or entries[0].file_size > LIMIT:
            raise ValueError("Invalid deployment state archive")
        return json.loads(bundle.read(entries[0]))


def run_states(actions, run_id):
    for artifact in actions.pages(f"actions/runs/{run_id}/artifacts", "artifacts"):
        if artifact.get("name") not in ARTIFACTS or artifact.get("expired"):
            continue
        state = read_state(
            actions.request(f"actions/artifacts/{artifact['id']}/zip", binary=True)
        )
        if state is not None:
            yield state


def reconciled(state, recovery):
    if recovery is None:
        return None
    binding = recovery.get("recoveryOf", {})
    decision = binding.get("decision")
    target = (
        state.get("previousImages")
        if decision == "operator-approved-image-rollback"
        else state.get("images")
    )
    configuration = (
        state.get("previousConfigSha256")
        if decision == "operator-approved-image-rollback"
        else state.get("desiredConfigSha256")
    )
    if (
        binding.get("failedStateSha256")
        != hashlib.sha256(
            json.dumps(state, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        or binding.get("runUrl") != state.get("runUrl")
        or decision
        not in ("operator-approved-image-rollback", "operator-approved-roll-forward")
        or recovery.get("rolloutStatus") != "PASS"
        or recovery.get("images") != target
        or not re.fullmatch(r"[a-f0-9]{64}", binding.get("configurationSha256", ""))
        or binding.get("configurationSha256") != configuration
        or not re.fullmatch(r"[a-f0-9]{64}", binding.get("trafficSha256", ""))
        or not re.fullmatch(r"[a-f0-9]{64}", binding.get("compatibilitySha256", ""))
    ):
        raise ValueError(
            "Protected recovery state does not reconcile this exact interrupted release"
        )
    return recovery


def check_attempt(actions, current_run, attempt, recovery=None):
    if attempt > 1:
        for state in run_states(actions, current_run):
            if (
                state.get("rolloutStatus") != "PASS"
                and state.get("mutationStarted") is not False
            ):
                resolved = reconciled(state, recovery)
                if resolved:
                    return resolved
                raise ValueError(
                    "Previous attempt mutated the cluster; reconcile before retry"
                )
            if state.get("rolloutStatus") == "PASS":
                return state
    return None


def discover(actions, current_run, attempt=1, recovery=None):
    previous_attempt = check_attempt(actions, current_run, attempt, recovery)
    if previous_attempt is not None:
        return previous_attempt
    for run in actions.pages("actions/runs?branch=main", "workflow_runs"):
        if (
            str(run["id"]) == str(current_run)
            or run.get("path") not in WORKFLOWS
            or run.get("head_branch") != "main"
            or run.get("event") != "workflow_dispatch"
        ):
            continue
        if run.get("status") != "completed":
            raise ValueError(
                "Another deployment is pending; finish it before releasing"
            )
        for state in run_states(actions, run["id"]):
            if state.get("rolloutStatus") != "PASS":
                if state.get("mutationStarted") is False:
                    continue
                resolved = reconciled(state, recovery)
                if resolved:
                    return resolved
                raise ValueError(
                    "Previous rollout is incomplete; reconcile live state first"
                )
            if run.get("conclusion") != "success":
                raise ValueError("Deployment state belongs to an unsuccessful run")
            if state.get("commit") != run.get("head_sha"):
                raise ValueError("Deployment state commit differs from its Actions run")
            return state
    return None
