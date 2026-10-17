"""Run real acceptance in a new owned app stack; preserves the user's existing data.

Prerequisites: Maven verify, npm build/build:local and local verified fixture images.
No cloud credentials, external payments or application-wide production maintenance.
"""

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from contextlib import contextmanager

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tooling/scripts"))
from mixed_version_check import IsolatedStack, run


@contextmanager
def configured_static(environment):
    npm = "npm.cmd" if os.name == "nt" else "npm"
    scoped = {**environment, "NEXT_PUBLIC_APP_URL": environment["SMOKE_BASE_URL"]}

    def build(values, label):
        with (ROOT / (".tools/full-acceptance-static-" + label + ".log")).open(
            "w", encoding="utf-8"
        ) as log:
            subprocess.run(
                [npm, "run", "build:local"],
                cwd=ROOT,
                env=values,
                stdout=log,
                stderr=subprocess.STDOUT,
                check=True,
                timeout=180,
            )

    try:
        build(scoped, "isolated")
        yield
    finally:
        build(os.environ.copy(), "default")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--age", default="age")
    parser.add_argument("--age-keygen", default="age-keygen")
    parser.add_argument("--port", type=int, default=18083)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        raise ValueError("Invalid private acceptance port")
    os.chdir(ROOT)
    records = []
    reports = ROOT / "testing/reports"
    reports.mkdir(parents=True, exist_ok=True)
    (ROOT / ".tools").mkdir(exist_ok=True)
    commands = [
        ("migration-only", [sys.executable, "testing/checks/migration_only.py"]),
        ("smoke", [sys.executable, "tooling/scripts/run.py", "smoke"]),
        ("billing-saga", [sys.executable, "testing/checks/billing_saga_check.py"]),
        *[
            (name, ["node", "testing/checks/" + name + ".cjs"])
            for name in (
                "local-tools-browser",
                "collaboration-browser",
                "billing-browser",
                "i18n-browser",
                "docsnest-browser",
                "source-files-browser",
                "structure-browser",
            )
        ],
        ("workspace-browser", ["node", "testing/checks/workspace-browser.cjs"]),
        ("worker", ["npm.cmd" if os.name == "nt" else "npm", "run", "worker-check"]),
        (
            "slow-traffic",
            [
                sys.executable,
                "tooling/scripts/rollout_traffic.py",
                "--local",
                "--seconds",
                "30",
                "--slow-seconds",
                "35",
            ],
        ),
        (
            "local-online-restore",
            [
                sys.executable,
                "testing/checks/local_online_restore_check.py",
                "--age",
                args.age,
                "--age-keygen",
                args.age_keygen,
            ],
        ),
    ]
    paced = []
    for name, command in commands:
        if (name.endswith("-browser") and name != "local-tools-browser") or name in (
            "smoke",
            "billing-saga",
            "slow-traffic",
            "local-online-restore",
        ):
            paced.append(
                (
                    "auth-budget-" + name,
                    [
                        sys.executable,
                        "testing/checks/auth_fixture_budget.py",
                        "--reserve",
                        "4",
                    ],
                )
            )
        paced.append((name, command))
    commands = paced
    print("Preparing isolated fresh acceptance stack", flush=True)
    with (
        IsolatedStack(args.port) as stack,
        configured_static(stack.child_environment()),
    ):
        environment = stack.child_environment()
        commands.insert(
            -1,
            (
                "online-sql-pitr",
                [
                    sys.executable,
                    "testing/checks/online_recovery_check.py",
                    "--source-container",
                    run([*stack.prefix, "ps", "-q", "mysql"]).strip(),
                    "--age",
                    args.age,
                    "--age-keygen",
                    args.age_keygen,
                ],
            ),
        )
        for name, command in commands:
            started = time.monotonic()
            print("BEGIN " + name, flush=True)
            with (ROOT / (".tools/full-acceptance-" + name + ".log")).open(
                "w", encoding="utf-8"
            ) as log:
                try:
                    code = subprocess.run(
                        command,
                        cwd=ROOT,
                        env=environment,
                        stdout=log,
                        stderr=subprocess.STDOUT,
                        timeout=1000,
                    ).returncode
                except subprocess.TimeoutExpired:
                    code = 124
            record = {
                "check": name,
                "status": "PASS" if code == 0 else "FAIL",
                "exitCode": code,
                "durationSeconds": round(time.monotonic() - started, 2),
            }
            records.append(record)
            print(
                record["status"]
                + " "
                + name
                + " "
                + str(record["durationSeconds"])
                + "s",
                flush=True,
            )
            (reports / "full-acceptance.json").write_text(
                json.dumps(
                    {
                        "scope": "owned fresh local stack only; no cloud acceptance",
                        "completedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                        "checks": records,
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
    if any(record["exitCode"] for record in records):
        raise SystemExit(
            "Acceptance failed; inspect protected local logs and bounded reports"
        )
    print("PASS complete isolated local acceptance; source application data preserved")


if __name__ == "__main__":
    main()
