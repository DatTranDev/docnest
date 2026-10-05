"""Read-only inventory limited to an explicitly supplied lab project; no deletion capability."""

import argparse, subprocess, re

p = argparse.ArgumentParser()
p.add_argument("--project", required=True)
a = p.parse_args()
if not re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]", a.project) or a.project.startswith(
    "your-"
):
    raise SystemExit("Supply the actual dedicated project ID")
commands = [
    ["compute", "instances", "list", "--filter=labels.application=text-editor"],
    ["container", "clusters", "list"],
    ["compute", "disks", "list"],
    ["compute", "addresses", "list"],
    ["compute", "forwarding-rules", "list"],
    ["storage", "buckets", "list"],
    ["artifacts", "repositories", "list"],
]
for cmd in commands:
    subprocess.run(["gcloud", *cmd, "--project=" + a.project], check=True)
