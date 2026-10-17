"""Bounded scalar diagnostics for owned acceptance containers; never retains raw logs."""

import json
import re
import time

from digest_manifest import NAMES
from mixed_version_check import run

SERVICES = {*NAMES, "mysql", "kafka", "redis"}
CODES = {
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EPIPE",
    "ERR_STREAM_PREMATURE_CLOSE",
}


def gateway_events(output):
    events = []
    for line in output.splitlines()[-100:]:
        try:
            row = json.loads(line[line.index("{") :])
        except (ValueError, json.JSONDecodeError):
            continue
        if row.get("event") == "UPSTREAM_FAILURE":
            events.append(
                {
                    "event": "UPSTREAM_FAILURE",
                    "code": row.get("code") if row.get("code") in CODES else "OTHER",
                    **{
                        key: row[key]
                        for key in ("reusedSocket", "headersSent", "retry")
                        if type(row.get(key)) is bool
                    },
                }
            )
    return events[-20:]


def states(records):
    result = []
    for row in records:
        service = (
            row.get("Config", {}).get("Labels", {}).get("com.docker.compose.service")
        )
        state = row.get("State", {})
        if service in SERVICES:
            result.append(
                {
                    "service": service,
                    "running": state.get("Running") is True,
                    "oomKilled": state.get("OOMKilled") is True,
                    "exitCode": int(state.get("ExitCode", 0)),
                    "restarts": int(row.get("RestartCount", 0)),
                    "health": (
                        state.get("Health", {}).get("Status")
                        if state.get("Health", {}).get("Status")
                        in ("healthy", "unhealthy", "starting")
                        else "unknown"
                    ),
                }
            )
    return result


def collect(prefix, since):
    try:
        identities = run([*prefix, "ps", "-a", "-q"], timeout=20).split()
        if not 1 <= len(identities) <= 20 or any(
            not re.fullmatch(r"[a-f0-9]{12,64}", value) for value in identities
        ):
            raise ValueError("Unexpected acceptance container inventory")
        records = json.loads(run(["docker", "inspect", *identities], timeout=20))
        projects = {
            row.get("Config", {}).get("Labels", {}).get("com.docker.compose.project")
            for row in records
        }
        if len(projects) != 1:
            raise ValueError("Ambiguous acceptance project")
        project = projects.pop()
        if not isinstance(project, str) or not re.fullmatch(
            r"text-editor|docsnest-(?:compat|check)-[a-f0-9]{12}", project
        ):
            raise ValueError("Unexpected acceptance project")
        oom = run(
            [
                "docker",
                "events",
                "--since",
                str(int(since)),
                "--until",
                str(int(time.time())),
                "--filter",
                "type=container",
                "--filter",
                "event=oom",
                "--filter",
                "label=com.docker.compose.project=" + project,
                "--format",
                "{{.Action}}",
            ],
            timeout=20,
        )
        return {
            "status": "COLLECTED",
            "containers": states(records),
            "oomEvents": sum(line == "oom" for line in oom.splitlines()),
            "dockerMemoryBytes": int(
                run(["docker", "info", "--format", "{{.MemTotal}}"], timeout=20).strip()
            ),
            "gatewayFailures": gateway_events(
                run([*prefix, "logs", "--no-color", "--tail", "100", "web"], timeout=20)
            ),
        }
    except Exception:
        return {
            "status": "UNAVAILABLE",
            "reason": "Bounded runtime diagnostics unavailable",
        }
