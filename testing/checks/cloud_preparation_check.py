"""Exercise real local Compose/Kustomize rendering, never cloud APIs or deployment."""

import json
import os
from pathlib import Path
import shutil
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
        identity = next(
            obj
            for obj in self.objects("applications")
            if obj["metadata"]["name"] == "identity-service"
        )["spec"]["template"]["spec"]
        container = identity["containers"][0]
        jwt_mount = next(m for m in container["volumeMounts"] if m["name"] == "jwt")
        self.assertEqual(
            container["args"],
            ["--editor.jwt.key-path=" + jwt_mount["mountPath"] + "/identity-key.pem"],
        )
        jwt_volume = next(v for v in identity["volumes"] if v["name"] == "jwt")
        self.assertEqual(jwt_volume["secret"]["secretName"], "editor-jwt")
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

    def test_public_config_change_updates_all_pod_templates_without_changing_images(
        self,
    ):
        self.render()
        before = self.objects("applications")
        self.render()
        self.assertEqual(before, self.objects("applications"))
        self.render("--max-users", "20")
        after = self.objects("applications")
        key = "docsnest.dattrandev.id.vn/config-sha256"
        for old, new in zip(before, after, strict=True):
            old_template, new_template = (obj["spec"]["template"] for obj in (old, new))
            self.assertNotEqual(
                old_template["metadata"]["annotations"][key],
                new_template["metadata"]["annotations"][key],
            )
            self.assertEqual(
                old_template["spec"]["containers"][0]["image"],
                new_template["spec"]["containers"][0]["image"],
            )

    def test_kafka_controller_and_advertised_endpoints_route_before_readiness(self):
        self.render()
        broker = next(
            obj
            for obj in self.objects("infrastructure")
            if obj["metadata"]["name"] == "kafka"
        )
        template = broker["spec"]["template"]
        container = template["spec"]["containers"][0]
        environment = {item["name"]: item.get("value") for item in container["env"]}
        services = {
            obj["metadata"]["name"]: obj["spec"]
            for obj in self.objects("bootstrap")
            if obj["kind"] == "Service"
        }
        controller = environment["KAFKA_CONTROLLER_QUORUM_VOTERS"].split("@", 1)[1]
        advertised = environment["KAFKA_ADVERTISED_LISTENERS"].split("://", 1)[1]
        pod_ports = {item["containerPort"] for item in container["ports"]}
        for endpoint in (controller, advertised):
            with self.subTest(endpoint=endpoint):
                host, port = endpoint.rsplit(":", 1)
                service = services[host]
                self.assertEqual(service.get("type", "ClusterIP"), "ClusterIP")
                for key, value in service["selector"].items():
                    self.assertEqual(template["metadata"]["labels"][key], value)
                ports = {item["port"]: item for item in service["ports"]}
                self.assertIn(int(port), ports, "Kafka endpoint has no Service port")
                route = ports[int(port)]
                self.assertEqual(route.get("protocol", "TCP"), "TCP")
                self.assertIn(route.get("targetPort", int(port)), pod_ports)
                self.assertTrue(
                    service.get("publishNotReadyAddresses"),
                    "Kafka bootstrap must not wait for its own readiness probe",
                )
        port_names = [item.get("name") for item in services["kafka"]["ports"]]
        self.assertTrue(all(port_names))
        self.assertEqual(len(port_names), len(set(port_names)))

    def test_kafka_volume_init_preserves_data_and_refuses_recovered_files(self):
        self.render()
        broker = next(
            obj
            for obj in self.objects("infrastructure")
            if obj["metadata"]["name"] == "kafka"
        )
        pod = broker["spec"]["template"]["spec"]
        initialize = pod["initContainers"][0]
        self.assertEqual(initialize["image"], pod["containers"][0]["image"])
        self.assertIn(
            initialize["volumeMounts"][0], pod["containers"][0]["volumeMounts"]
        )
        self.assertEqual(
            initialize["args"][1], initialize["volumeMounts"][0]["mountPath"]
        )
        command = initialize["command"].copy()
        if os.name == "nt":
            command[0] = str(
                Path(shutil.which("git")).resolve().parents[1] / "bin/bash.exe"
            )
        for kind in ("missing", "empty", "recovered", "file"):
            with self.subTest(kind=kind):
                volume = self.directory / kind
                volume.mkdir()
                metadata = volume / "meta.properties"
                metadata.write_bytes(b"test-cluster-metadata")
                segment = volume / "__cluster_metadata-0" / "segment.log"
                segment.parent.mkdir()
                segment.write_bytes(b"existing-kafka-records")
                recovery = volume / "lost+found"
                if kind in ("empty", "recovered"):
                    recovery.mkdir()
                if kind == "recovered":
                    (recovery / "recovered-file").write_bytes(b"preserve-recovery")
                if kind == "file":
                    recovery.write_bytes(b"unexpected-entry")
                for _ in range(2):
                    result = subprocess.run(
                        command + [initialize["args"][0], volume.as_posix()],
                        capture_output=True,
                        text=True,
                        timeout=10,
                    )
                    self.assertEqual(
                        result.returncode == 0, kind in ("missing", "empty")
                    )
                    self.assertEqual(metadata.read_bytes(), b"test-cluster-metadata")
                    self.assertEqual(segment.read_bytes(), b"existing-kafka-records")
                    if kind == "recovered":
                        self.assertEqual(
                            (recovery / "recovered-file").read_bytes(),
                            b"preserve-recovery",
                        )
                    elif kind == "file":
                        self.assertEqual(recovery.read_bytes(), b"unexpected-entry")
                    else:
                        self.assertFalse(recovery.exists())

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
