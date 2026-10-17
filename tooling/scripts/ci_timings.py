"""Publish actual per-job/step durations; incomplete work never becomes a speedup claim."""

import argparse
import datetime as dt
import json
import os
from pathlib import Path

from deployment_state import Actions


def durations(jobs):
    result = []
    for job in jobs:
        if job.get("status") != "completed":
            continue
        started, completed = job.get("started_at"), job.get("completed_at")
        if not started or not completed:
            continue
        seconds = (
            dt.datetime.fromisoformat(completed.replace("Z", "+00:00"))
            - dt.datetime.fromisoformat(started.replace("Z", "+00:00"))
        ).total_seconds()
        result.append(
            {
                "job": job["name"][:120],
                "conclusion": job.get("conclusion"),
                "seconds": seconds,
                "steps": [
                    {
                        "name": step["name"][:120],
                        "conclusion": step.get("conclusion"),
                        "seconds": (
                            dt.datetime.fromisoformat(
                                step["completed_at"].replace("Z", "+00:00")
                            )
                            - dt.datetime.fromisoformat(
                                step["started_at"].replace("Z", "+00:00")
                            )
                        ).total_seconds(),
                    }
                    for step in job.get("steps", [])
                    if step.get("status") == "completed"
                    and step.get("started_at")
                    and step.get("completed_at")
                ],
            }
        )
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", default=os.environ.get("GITHUB_RUN_ID"))
    parser.add_argument("--attempt", default=os.environ.get("GITHUB_RUN_ATTEMPT", "1"))
    parser.add_argument("--jobs-json", type=Path)
    parser.add_argument(
        "--output", type=Path, default=Path("testing/reports/cicd-timings.json")
    )
    args = parser.parse_args()
    if args.jobs_json:
        jobs = json.loads(args.jobs_json.read_text(encoding="utf-8"))["jobs"]
    else:
        if not args.run_id or not args.run_id.isdigit() or not args.attempt.isdigit():
            raise ValueError("Expected numeric Actions run/attempt")
        jobs = list(
            Actions().pages(
                f"actions/runs/{args.run_id}/attempts/{args.attempt}/jobs", "jobs"
            )
        )
    report = {
        "runId": args.run_id,
        "attempt": args.attempt,
        "scope": "Completed jobs/steps only; parallel durations are not summed; in-progress work is omitted",
        "jobs": durations(jobs),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
            summary.write(
                "\nMeasured completed job durations are retained in cicd-timings.json. No cold/warm or single-service speedup is inferred.\n"
            )


if __name__ == "__main__":
    main()
