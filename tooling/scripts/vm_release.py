"""Quiesced, encrypted-backup VM rollout; invoked explicitly by the manual workflow.

Runs as root on the existing VM. Never provisions infrastructure or restores SQL.
Command output is withheld because Compose and backup commands can contain secrets.
"""

import argparse
import datetime
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
from types import SimpleNamespace

from digest_manifest import NAMES, validate_manifest

IMAGE_KEYS = {name: name.removesuffix("-service").upper() + "_IMAGE" for name in NAMES}


def execute(command, *, timeout=900):
    try:
        result = subprocess.run(command, capture_output=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise ValueError(
            "Deployment command unavailable or timed out; output withheld"
        ) from None
    if result.returncode:
        raise ValueError("Deployment command failed; output withheld")
    return result.stdout


def save_json(path, value):
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=".release-")
    with os.fdopen(fd, "w") as output:
        json.dump(value, output, indent=2)
        output.write("\n")
    os.replace(temporary, path)


def validate_config(config):
    if set(config) != {
        "project",
        "region",
        "origin",
        "backups_bucket",
        "jwt_version",
        "age_recipient",
    }:
        raise ValueError("Unexpected deployment configuration fields")
    validate_manifest(
        {
            name: f'{config["region"]}-docker.pkg.dev/{config["project"]}/editor/{name}@sha256:'
            + "0" * 64
            for name in NAMES
        },
        config["project"],
        config["region"],
    )
    if not re.fullmatch(r"https://[A-Za-z0-9][A-Za-z0-9.-]*", config["origin"]):
        raise ValueError("Expected exact public HTTPS origin")
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", config["backups_bucket"]):
        raise ValueError("Invalid private backup bucket")
    if not re.fullmatch(r"[1-9][0-9]*", str(config["jwt_version"])):
        raise ValueError("JWT version must be numeric")
    if not re.fullmatch(
        r"age1[023456789acdefghjklmnpqrstuvwxyz]{58}", config["age_recipient"]
    ):
        raise ValueError("Expected an age public recipient")
    return config


def unpack(archive, destination):
    with tarfile.open(archive, "r:gz") as source:
        members = []
        total = 0
        seen = set()
        for member in source:
            total += member.size
            if len(members) >= 20000 or total > 256 * 1024 * 1024:
                raise ValueError("Release archive exceeds bounds")
            path = destination / member.name
            if (
                member.name in seen
                or not path.resolve().is_relative_to(destination.resolve())
                or not (member.isfile() or member.isdir())
            ):
                raise ValueError("Unsafe release archive member")
            seen.add(member.name)
            members.append(member)
        source.extractall(destination, members=members, filter="data")


class Rollout:
    def __init__(self, root, config, backup_helper=None):
        self.root = root
        self.config = config
        self.backup_helper = backup_helper or root / "tooling/scripts/cloud_backup.py"
        self.override = root / "vm-runtime.json"
        save_json(
            self.override,
            {
                "services": {
                    "identity-service": {
                        "command": ["--editor.jwt.key-path=/data/keys/identity-key.pem"]
                    },
                    "https": {
                        "volumes": [
                            f"{root}/infra/gcp/Caddyfile:/etc/caddy/Caddyfile:ro"
                        ]
                    },
                }
            },
        )

    def compose(self, release, *arguments):
        return execute(
            [
                "docker",
                "compose",
                "--project-name",
                "text-editor",
                "--env-file",
                str(self.root / "cloud.env"),
                "--env-file",
                release["env"],
                "-f",
                str(Path(release["source"]) / "infra/compose/compose.yaml"),
                "-f",
                str(Path(release["source"]) / "infra/gcp/compose.cloud.yaml"),
                "-f",
                str(self.override),
                "--profile",
                "app",
                *arguments,
            ]
        )

    def capture_previous(self):
        state = self.root / "vm-state.json"
        previous = (
            json.loads(state.read_text())
            if state.exists()
            else {"source": str(self.root), "commit": "adopted"}
        )
        if previous.get("nativeFormatVersion", 6) != 6:
            raise ValueError(
                "Native format compatibility requires an operator-reviewed rollout"
            )
        images = {}
        for name in NAMES:
            container = json.loads(
                execute(["docker", "inspect", f"text-editor-{name}-1"])
            )[0]
            if container["State"].get("Health", {}).get("Status") != "healthy":
                raise ValueError(
                    "Every existing application must be healthy before rollout"
                )
            images[name] = container["Config"]["Image"]
        validate_manifest(images, self.config["project"], self.config["region"])
        previous["images"] = images
        previous["env"] = str(self.root / "previous-images.env")
        self.write_images(Path(previous["env"]), images)
        return previous

    def write_images(self, path, images):
        path.write_text(
            "".join(f"{IMAGE_KEYS[name]}={images[name]}\n" for name in NAMES)
        )
        path.chmod(0o600)

    def start(self, release):
        self.compose(
            release,
            "up",
            "-d",
            "--no-build",
            "--no-deps",
            "--wait",
            "--wait-timeout",
            "360",
            *NAMES[:-1],
        )
        self.compose(
            release,
            "up",
            "-d",
            "--no-build",
            "--no-deps",
            "--wait",
            "--wait-timeout",
            "360",
            "web",
        )
        self.compose(release, "up", "-d", "--no-build", "--no-deps", "https")
        execute(
            [
                "curl",
                "--fail",
                "--silent",
                "--show-error",
                "--retry",
                "5",
                "--retry-all-errors",
                "--max-time",
                "30",
                self.config["origin"] + "/healthz",
            ]
        )

    def backup(self, previous, directory):
        spec = importlib.util.spec_from_file_location(
            "vm_cloud_backup", self.backup_helper
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.ROOT = Path(previous["source"])
        effective = directory.parent / "backup-effective.env"
        effective.write_text(
            (self.root / "cloud.env").read_text()
            + "\n"
            + Path(previous["env"]).read_text()
        )
        effective.chmod(0o600)
        images_file = directory.parent / "backup-images.json"
        save_json(images_file, previous["images"])
        module.backup(
            SimpleNamespace(
                environment="vm",
                compose_env=str(effective),
                directory=str(directory),
                project=self.config["project"],
                images=str(images_file),
                jwt_secret_version=f'projects/{self.config["project"]}/secrets/editor-jwt/versions/{self.config["jwt_version"]}',
            )
        )
        manifest = json.loads((directory / "manifest.json").read_text())
        tar_path = directory.with_suffix(".tar.gz")
        encrypted = directory.with_suffix(".tar.gz.age")
        with tarfile.open(tar_path, "w:gz") as archive:
            archive.add(directory, arcname="backup")
        execute(
            [
                "age",
                "-r",
                self.config["age_recipient"],
                "-o",
                str(encrypted),
                str(tar_path),
            ]
        )
        reference = f'gs://{self.config["backups_bucket"]}/vm-releases/{encrypted.name}'
        execute(
            [
                "gcloud",
                "storage",
                "cp",
                "--quiet",
                "--project",
                self.config["project"],
                str(encrypted),
                reference,
            ]
        )
        # Only remove this newly captured protected directory after encrypted upload.
        if directory.parent != self.root / "vm-backups":
            raise ValueError("Unexpected backup cleanup target")
        shutil.rmtree(directory)
        tar_path.unlink()
        effective.unlink()
        images_file.unlink()
        return manifest["flyway"], reference

    def histories(self, release):
        spec = importlib.util.spec_from_file_location(
            "vm_cloud_backup", self.backup_helper
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.ROOT = Path(release["source"])
        database = module.Database(
            SimpleNamespace(environment="vm", compose_env=str(self.root / "cloud.env"))
        )
        return {
            name: database.query(
                name,
                "SELECT JSON_OBJECT('version',version,'checksum',checksum,'success',success) FROM flyway_schema_history WHERE version IS NOT NULL ORDER BY installed_rank;",
            )
            for name in module.DBS
        }

    def deploy(self, release):
        previous = self.capture_previous()
        self.compose(release, "config", "--quiet")
        self.compose(release, "pull", *NAMES)
        timestamp = datetime.datetime.now(datetime.timezone.utc).strftime(
            "%Y%m%dT%H%M%SZ"
        )
        backups = self.root / "vm-backups"
        backups.mkdir(mode=0o700, exist_ok=True)
        saved = None
        migration_started = False
        paused = True
        try:
            self.compose(previous, "stop", "https", *NAMES)
            saved, reference = self.backup(
                previous, backups / (timestamp + "-" + release["commit"][:12])
            )
            for name in NAMES[:-1]:
                migration_started = True
                self.compose(
                    release,
                    "run",
                    "--rm",
                    "--no-deps",
                    name,
                    "--editor.migrate-only=true",
                )
            self.start(release)
            paused = False
            release["backup"] = reference
            release["previous"] = {
                key: previous[key] for key in ("source", "commit", "images")
            }
            save_json(self.root / "vm-state.json", release)
            print(
                json.dumps(
                    {
                        "status": "DEPLOYED",
                        "commit": release["commit"],
                        "backup": reference,
                    }
                )
            )
        except Exception:
            if paused:
                self.compose(release, "stop", "https", *NAMES)
                if not migration_started or (
                    saved is not None and self.histories(release) == saved
                ):
                    self.start(previous)
                    print(
                        "Previous applications recovered; SQL and objects were not restored."
                    )
                else:
                    print(
                        "Schema changed or cannot be verified; applications remain stopped. Review protected backup and migration state before recovery."
                    )
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--root", default="/opt/editor")
    args = parser.parse_args()
    if os.name != "posix" or os.geteuid() != 0:
        raise ValueError("Run on the existing Linux VM as root")
    import fcntl

    os.umask(0o077)
    root = Path(args.root).resolve()
    if root != Path("/opt/editor"):
        raise ValueError("Deployment root must be /opt/editor")
    with (root / ".vm-release.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        config_path = root / "vm-deploy.json"
        for protected in (config_path, root / "cloud.env"):
            if protected.stat().st_uid != 0 or protected.stat().st_mode & 0o077:
                raise ValueError(
                    "Deployment configuration must be root-owned and private"
                )
        config = validate_config(json.loads(config_path.read_text()))
        for tool in ("docker", "gcloud", "age", "curl"):
            if shutil.which(tool) is None:
                raise ValueError("Missing deployment prerequisite: " + tool)
        with tempfile.TemporaryDirectory(prefix=".age-check-", dir=root) as directory:
            execute(
                [
                    "age",
                    "-r",
                    config["age_recipient"],
                    "-o",
                    str(Path(directory) / "probe.age"),
                    "/dev/null",
                ]
            )
        manifest = json.loads(Path(args.manifest).read_text())
        if (
            not re.fullmatch(r"[a-f0-9]{40}", args.commit)
            or manifest.get("commit") != args.commit
            or manifest.get("ref") != "refs/heads/main"
        ):
            raise ValueError("Release must match the tested main commit")
        if manifest.get("nativeFormatVersion") != 6:
            raise ValueError("Routine VM rollout requires V6-compatible images")
        images = validate_manifest(
            manifest["images"], config["project"], config["region"]
        )
        environment = dict(
            line.split("=", 1)
            for line in (root / "cloud.env").read_text().splitlines()
            if line and not line.startswith("#") and "=" in line
        )
        if (
            environment.get("WEB_ORIGIN") != config["origin"]
            or environment.get("STORAGE_PROVIDER") != "GCS"
        ):
            raise ValueError(
                "VM origin/storage differs from reviewed deployment configuration"
            )
        if environment.get("GOOGLE_CLIENT_ID", "") != manifest.get("googleClientId"):
            raise ValueError(
                "Web build and VM Google Client IDs differ; review configuration before rollout"
            )
        releases = root / "vm-releases"
        releases.mkdir(mode=0o700, exist_ok=True)
        source = Path(tempfile.mkdtemp(prefix=args.commit[:12] + "-", dir=releases))
        unpack(args.archive, source)
        for required in (
            "infra/compose/compose.yaml",
            "infra/gcp/compose.cloud.yaml",
            "tooling/scripts/cloud_backup.py",
        ):
            if not (source / required).is_file():
                raise ValueError("Incomplete release source")
        rollout = Rollout(root, config, source / "tooling/scripts/cloud_backup.py")
        env_path = source / "images.env"
        rollout.write_images(env_path, images)
        rollout.deploy(
            {
                "commit": args.commit,
                "source": str(source),
                "env": str(env_path),
                "images": images,
                "nativeFormatVersion": 6,
            }
        )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Do not dump command output, configuration or credentials to Actions.
        print(
            "VM deployment failed: "
            + (str(error) if isinstance(error, ValueError) else type(error).__name__)
        )
        raise SystemExit(1) from None
