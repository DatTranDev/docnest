"""Validate GKE rollout inputs offline; no provisioning, credentials or deployment."""

import json
import os
from pathlib import Path
import re

from digest_manifest import validate_manifest


def validate_inputs(
    images,
    release,
    *,
    project,
    region,
    commit,
    client_id,
    backups,
    reference,
    require_release,
):
    validate_manifest(images, project, region)
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]", backups):
        raise ValueError("Invalid private backup bucket")
    prefix = "gs://" + backups + "/"
    if not reference.startswith(prefix) or not re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9._/-]{0,512}\.(age|gpg)", reference[len(prefix) :]
    ):
        raise ValueError(
            "Reviewed backup must be an encrypted object in the configured bucket"
        )
    if not release:
        if require_release:
            raise ValueError("Build and deploy requires its same-run release manifest")
        return
    if (
        not isinstance(release, dict)
        or not re.fullmatch(r"[a-f0-9]{40}", commit)
        or release.get("commit") != commit
        or release.get("ref") != "refs/heads/main"
        or release.get("nativeFormatVersion") != 6
        or release.get("googleClientId") != client_id
        or release.get("images") != images
    ):
        raise ValueError(
            "Release metadata must match this main commit, V6, Google client and all six digests"
        )


def main():
    try:
        images = json.loads(Path("digests.json").read_text())
        release_json = os.environ.get("RELEASE_JSON", "")
        if os.environ["REQUIRE_RELEASE"] not in ("true", "false"):
            raise ValueError("Invalid release-validation mode")
        validate_inputs(
            images,
            json.loads(release_json) if release_json else None,
            project=os.environ["PROJECT"],
            region=os.environ["REGION"],
            commit=os.environ["GITHUB_SHA"],
            client_id=os.environ.get("GOOGLE_CLIENT_ID", ""),
            backups=os.environ["BACKUPS"],
            reference=os.environ["BACKUP_REFERENCE"],
            require_release=os.environ["REQUIRE_RELEASE"] == "true",
        )
    except (ValueError, KeyError, TypeError, OSError):
        raise SystemExit(
            "Rejected GKE release or backup inputs; protected values withheld"
        ) from None
    print(
        "Validated GKE release and scoped encrypted backup reference; remote existence checked separately"
    )


if __name__ == "__main__":
    main()
