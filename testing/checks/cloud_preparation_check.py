"""Exercise real local Compose/Kustomize rendering, never cloud APIs or deployment."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[2]
NAMES = (
    "identity-service",
    "document-service",
    "processing-service",
    "collaboration-service",
    "payment-service",
    "web",
)
CLIENT = "1234567890-testclient.apps.googleusercontent.com"
ORIGIN = "https://editor.example.com"


class CloudPreparationTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.digests = {
            name: f"us-central1-docker.pkg.dev/example-lab/editor/{name}@sha256:"
            + "a" * 64
            for name in NAMES
        }
        self.manifest = self.directory / "digests.json"
        self.manifest.write_text(json.dumps(self.digests), encoding="utf-8")

    def render(self, *extra, success=True):
        result = subprocess.run(
            [
                sys.executable,
                str(ROOT / "tooling/scripts/render_cloud.py"),
                "--project",
                "example-lab",
                "--origin",
                ORIGIN,
                "--snapshots-bucket",
                "example-lab-snapshots",
                "--results-bucket",
                "example-lab-results",
                "--digests",
                str(self.manifest),
                "--output",
                str(self.directory / "render"),
                *extra,
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(result.returncode == 0, success, result.stderr)
        return result

    def objects(self, name):
        return list(
            yaml.safe_load_all(
                (self.directory / "render" / (name + ".yaml")).read_text(
                    encoding="utf-8"
                )
            )
        )

    def test_gke_public_configuration_and_all_migrations(self):
        self.render(
            "--google-client-id",
            CLIENT,
            "--max-users",
            "100",
            "--stripe-pro-monthly-price",
            "price_monthly123",
            "--stripe-pro-yearly-price",
            "price_yearly123",
        )
        config = next(
            obj for obj in self.objects("bootstrap") if obj["kind"] == "ConfigMap"
        )["data"]
        self.assertEqual(config["GOOGLE_CLIENT_ID"], CLIENT)
        self.assertEqual(config["MAX_USERS"], "100")
        self.assertEqual(config["ALLOWED_ORIGINS"], ORIGIN)
        self.assertEqual(config["STRIPE_PRO_MONTHLY_PRICE"], "price_monthly123")
        self.assertEqual(config["STRIPE_PRO_YEARLY_PRICE"], "price_yearly123")
        for group, names in (("applications", NAMES), ("migrations", NAMES[:-1])):
            objects = self.objects(group)
            self.assertEqual(len(objects), len(names))
            self.assertEqual(
                {obj["metadata"]["name"].removeprefix("migrate-") for obj in objects},
                set(names),
            )
            for obj in objects:
                name = obj["metadata"]["name"].removeprefix("migrate-")
                container = obj["spec"]["template"]["spec"]["containers"][0]
                self.assertEqual(container["image"], self.digests[name])
        self.assertEqual(config["JWT_ALLOW_KEY_GENERATION"], "false")
        self.assertEqual(config["FLYWAY_ENABLED"], "false")

    def test_optional_google_and_stripe_remain_disabled(self):
        self.render()
        config = next(
            obj for obj in self.objects("bootstrap") if obj["kind"] == "ConfigMap"
        )["data"]
        self.assertEqual(config["GOOGLE_CLIENT_ID"], "")
        self.assertEqual(config["MAX_USERS"], "10")
        self.assertEqual(config["STRIPE_PRO_MONTHLY_PRICE"], "")
        self.assertEqual(config["STRIPE_PRO_YEARLY_PRICE"], "")

    def test_invalid_public_configuration_rejected_before_writing(self):
        cases = (
            ("--origin", "http://editor.example.com"),
            ("--origin", ORIGIN + "/login"),
            ("--origin", "https://user:password@editor.example.com"),
            ("--origin", ORIGIN + "?next=login"),
            ("--origin", ORIGIN + "#login"),
            ("--origin", ORIGIN + ":99999"),
            ("--max-users", "0"),
            ("--google-client-id", "not-a-client"),
            ("--stripe-pro-monthly-price", "price_onlyone"),
        )
        for case in cases:
            with self.subTest(case=case):
                self.render(*case, success=False)
                self.assertFalse((self.directory / "render").exists())

    def test_foreign_digest_rejected(self):
        self.digests["web"] = self.digests["web"].replace("example-lab", "foreign-lab")
        self.manifest.write_text(json.dumps(self.digests), encoding="utf-8")
        self.render(success=False)
        self.assertFalse((self.directory / "render").exists())

    def test_vm_cloud_overlay_preserves_exact_origin_and_identity(self):
        values = {}
        for line in (ROOT / "infra/gcp/cloud.env.example").read_text().splitlines():
            if line and not line.startswith("#"):
                key, value = line.split("=", 1)
                values[key] = "a" * 64 if value == "SECRET_MANAGER_REFERENCE" else value
        values.update(WEB_ORIGIN=ORIGIN, GOOGLE_CLIENT_ID=CLIENT, MAX_USERS="100")
        for name in NAMES:
            key = name.removesuffix("-service").upper() + "_IMAGE"
            values[key] = self.digests[name]
        target = self.directory / "cloud.env"
        target.write_text(
            "".join(key + "=" + value + "\n" for key, value in values.items()),
            encoding="utf-8",
        )
        environment = {
            key: value for key, value in os.environ.items() if key not in values
        }
        result = subprocess.run(
            [
                "docker",
                "compose",
                "--env-file",
                str(target),
                "-f",
                "infra/compose/compose.yaml",
                "-f",
                "infra/gcp/compose.cloud.yaml",
                "--profile",
                "app",
                "config",
                "--format",
                "json",
            ],
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
        )
        services = json.loads(result.stdout)["services"]
        identity = services["identity-service"]["environment"]
        self.assertEqual(
            services["identity-service"]["command"],
            ["--editor.jwt.key-path=/data/keys/identity-key.pem"],
        )
        self.assertEqual(identity["ALLOWED_ORIGINS"], ORIGIN)
        self.assertEqual(identity["GOOGLE_CLIENT_ID"], CLIENT)
        self.assertEqual(identity["MAX_USERS"], "100")
        self.assertEqual(identity["SECURE_COOKIES"], "true")
        self.assertEqual(identity["JWT_ALLOW_KEY_GENERATION"], "false")
        for name in NAMES:
            self.assertEqual(services[name]["image"], self.digests[name])
        for name in NAMES[:-1]:
            self.assertEqual(services[name]["environment"]["FLYWAY_ENABLED"], "false")
            self.assertFalse(services[name].get("ports"))
        self.assertEqual(
            services["web"]["build"]["args"]["NEXT_PUBLIC_GOOGLE_CLIENT_ID"], CLIENT
        )


if __name__ == "__main__":
    unittest.main()
