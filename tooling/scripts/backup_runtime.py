"""Prepare private runner inputs from independently authorized release metadata."""

import argparse
import configparser
from contextlib import contextmanager
import datetime as dt
import json
import os
from pathlib import Path
import re
import tempfile
import ipaddress
import urllib.parse
import urllib.request

from digest_manifest import validate_manifest
from online_backup import run


def validate_release(value, config, name):
    match = re.fullmatch(r"approved-releases/([1-9][0-9]*)-([1-9][0-9]*)\.json", name)
    if (
        not match
        or not re.fullmatch(
            r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", config["repository"]
        )
        or not isinstance(value, dict)
        or set(value)
        != {"format", "repository", "commit", "runUrl", "runAttempt", "images"}
        or type(value["format"]) is not int
        or value["format"] != 1
        or value["repository"] != config["repository"]
        or not re.fullmatch(r"[a-f0-9]{40}", value.get("commit", ""))
        or value["runUrl"] != config["repository"] + "/actions/runs/" + match[1]
        or type(value["runAttempt"]) is not int
        or value["runAttempt"] != int(match[2])
    ):
        raise ValueError("Approved backup release metadata binding rejected")
    return validate_manifest(value["images"], config["project"], config["region"])


def latest_release(rows, bucket):
    if not isinstance(rows, list) or not 1 <= len(rows) <= 10000:
        raise ValueError("Approved release listing is empty or exceeds its budget")
    candidates = []
    for row in rows:
        metadata = row.get("metadata", {})
        if (
            row.get("type") != "cloud_object"
            or metadata.get("bucket") != bucket
            or not re.fullmatch(
                r"approved-releases/[1-9][0-9]*-[1-9][0-9]*\.json",
                metadata.get("name", ""),
            )
            or not re.fullmatch(r"[1-9][0-9]*", metadata.get("generation", ""))
        ):
            raise ValueError("Unexpected object in the approved release prefix")
        created = dt.datetime.fromisoformat(
            metadata["timeCreated"].replace("Z", "+00:00")
        )
        if created.tzinfo is None or created > dt.datetime.now(
            dt.timezone.utc
        ) + dt.timedelta(minutes=5):
            raise ValueError("Approved release object timestamp rejected")
        candidates.append((created, int(metadata["generation"]), metadata))
    return max(candidates, key=lambda candidate: candidate[:2])[2]


def approved_images(config):
    prefix = config["approvedReleasePrefix"]
    match = re.fullmatch(r"gs://([a-z0-9][a-z0-9._-]+)/approved-releases", prefix)
    if not match or config["destinationPrefix"] != "gs://" + match[1] + "/recovery":
        raise ValueError("Approved metadata must use the independent recovery bucket")
    raw = run(
        [
            "gcloud",
            "storage",
            "ls",
            "--json",
            "--project",
            config["project"],
            prefix + "/",
        ]
    )
    if len(raw) > 8 * 1024**2:
        raise ValueError("Approved release listing exceeds its byte budget")
    metadata = latest_release(json.loads(raw), match[1])
    value = run(
        [
            "gcloud",
            "storage",
            "cat",
            "--project",
            config["project"],
            "gs://" + match[1] + "/" + metadata["name"] + "#" + metadata["generation"],
        ]
    )
    if len(value) > 16384:
        raise ValueError("Approved release metadata exceeds its byte budget")
    return validate_release(json.loads(value), config, metadata["name"])


def mysql_endpoint(value):
    subsets = value.get("subsets", [])
    if len(subsets) != 1 or len(subsets[0].get("addresses", [])) != 1:
        raise ValueError("Require exactly one ready source MySQL endpoint")
    if subsets[0].get("notReadyAddresses") or not any(
        port.get("port") == 3306 and port.get("protocol", "TCP") == "TCP"
        for port in subsets[0].get("ports", [])
    ):
        raise ValueError("Source MySQL endpoint is not ready on TCP3306")
    address = ipaddress.IPv4Address(subsets[0]["addresses"][0]["ip"])
    if not any(
        address in ipaddress.IPv4Network(network)
        for network in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
    ):
        raise ValueError("Source MySQL must use a private IPv4 endpoint")
    return str(address)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


def publish_approval(value, bucket, name, project):
    # A single conditional insert needs only objectCreator on approved-releases/.
    # The storage CLI also lists the destination bucket during cp; deployment
    # deliberately receives no recovery-object read/list permission.
    query = urllib.parse.urlencode(
        {"uploadType": "media", "name": name, "ifGenerationMatch": "0"}
    )
    token = (
        run(["gcloud", "auth", "print-access-token", "--project", project])
        .decode()
        .strip()
    )
    request = urllib.request.Request(
        "https://storage.googleapis.com/upload/storage/v1/b/" + bucket + "/o?" + query,
        data=json.dumps(value).encode(),
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    opener = urllib.request.build_opener(NoRedirect())
    with opener.open(request, timeout=30) as response:
        body = response.read(16385)
    if len(body) > 16384:
        raise ValueError("Approval upload response exceeds its budget")
    result = json.loads(body)
    if (
        result.get("name") != name
        or result.get("bucket") != bucket
        or not re.fullmatch(r"[1-9][0-9]*", result.get("generation", ""))
    ):
        raise ValueError("Approval upload identity mismatch")
    return result["generation"]


@contextmanager
def prepared_config(config, *, snapshot):
    with tempfile.TemporaryDirectory(
        prefix="runner-inputs-", dir=Path(config["outputDirectory"]) / "tmp"
    ) as temporary:
        directory = Path(temporary)
        prepared = dict(config)
        if config.get("refreshMysqlEndpoint"):
            value = json.loads(
                run(
                    [
                        "kubectl",
                        "--context",
                        config["context"],
                        "-n",
                        "editor-lab",
                        "get",
                        "endpoints",
                        "mysql",
                        "-o",
                        "json",
                    ]
                )
            )
            defaults = configparser.ConfigParser(interpolation=None)
            with Path(config["mysqlDefaults"]).open(encoding="utf-8") as stream:
                defaults.read_file(stream)
            if defaults.get("client", "ssl-mode") != "VERIFY_CA":
                raise ValueError("Runner MySQL connection requires verified CA TLS")
            defaults.set("client", "host", mysql_endpoint(value))
            target = directory / "mysql.cnf"
            with target.open("x", encoding="utf-8") as stream:
                os.chmod(target, 0o600)
                defaults.write(stream, space_around_delimiters=False)
            prepared["mysqlDefaults"] = str(target)
        if snapshot and config.get("approvedReleasePrefix"):
            target = directory / "approved-images.json"
            target.write_text(json.dumps(approved_images(config)), encoding="utf-8")
            prepared["images"] = str(target)
        yield prepared


def main():
    from release_evidence import verify
    from release_manifest import validate_provenance

    parser = argparse.ArgumentParser(
        description="Publish scalar image approval after successful rollout checks"
    )
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--destination-prefix", required=True)
    args = parser.parse_args()
    destination = re.fullmatch(
        r"gs://([a-z0-9][a-z0-9._-]+)/approved-releases", args.destination_prefix
    )
    if not destination:
        raise ValueError("Explicit independent approved release prefix required")
    verify(args.evidence)
    state = json.loads(
        (args.evidence / "environment-state.json").read_text(encoding="utf-8")
    )
    config = {
        "repository": os.environ["REPOSITORY_URL"],
        "project": os.environ["PROJECT"],
        "region": os.environ["REGION"],
    }
    if (
        state.get("environment") != "cloud-gke"
        or state.get("ref") != "refs/heads/main"
        or state.get("runUrl") != os.environ["RUN_URL"]
        or state.get("commit") != os.environ["GITHUB_SHA"]
    ):
        raise ValueError("Approval must bind this checked repository run and commit")
    validate_provenance(
        state.get("imageProvenance"), state["images"], config["repository"]
    )
    run_id = state["runUrl"].rsplit("/", 1)[1]
    name = (
        "approved-releases/" + run_id + "-" + os.environ["GITHUB_RUN_ATTEMPT"] + ".json"
    )
    value = {
        "format": 1,
        "repository": config["repository"],
        "runUrl": state["runUrl"],
        "runAttempt": int(os.environ["GITHUB_RUN_ATTEMPT"]),
        "commit": state["commit"],
        "images": state["images"],
    }
    validate_release(value, config, name)
    publish_approval(value, destination[1], name, config["project"])
    print(
        "Published immutable six-image backup approval; no credentials or document data included"
    )


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit(
            "Backup release approval publication failed; protected output withheld"
        ) from None
