"""Offline deployment assertions; these do not replace cluster or cloud smoke tests."""

import datetime
import json
import pathlib
import subprocess

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
APPLICATIONS = ("identity-service", "document-service", "processing-service", "web")


def read(relative):
    return (ROOT / relative).read_text(encoding="utf-8")


def resource(objects, kind, name):
    return next(
        item
        for item in objects
        if item["kind"] == kind and item["metadata"]["name"] == name
    )


def main():
    render = subprocess.run(
        ["kubectl", "kustomize", str(ROOT / "infra/k8s/overlays/lab")],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    objects = list(yaml.safe_load_all(render))
    checks = []
    identities = {(item["kind"], item["metadata"]["name"]) for item in objects}
    assert len(identities) == len(objects), "Duplicate rendered resource identity"
    for item in objects:
        if item["kind"] == "Service":
            assert item["spec"].get("type", "ClusterIP") == "ClusterIP"
        if item["kind"] not in ("Deployment", "StatefulSet"):
            continue
        for container in item["spec"]["template"]["spec"]["containers"]:
            assert "latest" not in container["image"]
            assert container["resources"]["requests"]
            assert container["resources"]["limits"]
            assert "readinessProbe" in container
            if item["kind"] == "Deployment" and item["metadata"]["name"] != "redis":
                assert "livenessProbe" in container and "startupProbe" in container
        if item["kind"] == "StatefulSet":
            assert item["spec"]["volumeClaimTemplates"]
    checks.extend(
        [
            "Kustomize rendering and unique resource identities",
            "private ClusterIP services",
            "explicit resources/readiness/startup/liveness",
            "persistent SQL and Kafka PVCs",
            "no latest image tags",
        ]
    )

    compose = yaml.safe_load(read("infra/compose/compose.yaml"))
    for service in ("mysql", "kafka", "redis"):
        config = compose["services"][service]
        assert "@sha256:" in config["image"] and not config.get("ports")
    gateway = read("apps/web/server/gateway.mjs")
    for required in (
        "normalized.startsWith('/internal')",
        "normalized.startsWith('/actuator')",
        "http://127.0.0.1:${privatePort}",
        "nextReady(config, isNextAlive)",
        "32 * 1024 * 1024",
        "130_000",
        "stdio: 'ignore'",
    ):
        assert required in gateway, "Missing gateway constraint: " + required

    web = resource(objects, "Deployment", "web")
    pod = web["spec"]["template"]["spec"]
    container = pod["containers"][0]
    assert pod["terminationGracePeriodSeconds"] == 45
    assert container["securityContext"]["runAsUser"] == 1000
    assert container["resources"]["limits"]["memory"] == "512Mi"
    assert [port["containerPort"] for port in container["ports"]] == [8080]
    environment = {entry["name"]: entry.get("value") for entry in container["env"]}
    assert environment["NEXT_INTERNAL_PORT"] == "3000"
    assert environment["TRUSTED_PROXY_CIDRS"] == ""
    for name, service in (
        ("IDENTITY_INTERNAL_ORIGIN", "identity-service"),
        ("DOCUMENT_INTERNAL_ORIGIN", "document-service"),
        ("PROCESSING_INTERNAL_ORIGIN", "processing-service"),
    ):
        assert environment[name] == "http://" + service + ":8080"
    for probe in ("startupProbe", "readinessProbe", "livenessProbe"):
        assert container[probe]["httpGet"] == {"path": "/healthz", "port": 8080}
    web_service = resource(objects, "Service", "web")
    assert (
        json.loads(web_service["metadata"]["annotations"]["cloud.google.com/neg"])[
            "ingress"
        ]
        is True
    )

    dockerfile = read("infra/compose/Web.Dockerfile")
    for required in (
        "COPY tools ./tools",
        ".next/standalone",
        ".next/static",
        "USER node",
        "gateway.mjs",
    ):
        assert required in dockerfile
    assert "FROM nginx" not in dockerfile
    assert "**/.next" in read(".dockerignore")
    web_compose = compose["services"]["web"]
    assert web_compose["init"] is True and web_compose["mem_limit"] == "512m"
    assert web_compose["stop_grace_period"] == "45s"
    assert "node" in web_compose["healthcheck"]["test"]
    checks.extend(
        [
            "infrastructure images digest pinned/internal ports closed",
            "Next standalone/static assets behind streaming gateway; private routes, child readiness, body cap and deadline configured",
            "web UID1000,512Mi limit,private Next port,45second grace,explicit NEG and untrusted forwarding default",
        ]
    )

    migration_inventory = {}
    for service in ("identity", "document", "processing"):
        schema = ROOT / "schema" / service
        deployed = (
            ROOT
            / "services"
            / (service + "-service")
            / "src/main/resources/db/migration"
        )
        source_files = {path.name: path for path in schema.glob("V*__*.sql")}
        deployed_files = {path.name: path for path in deployed.glob("V*__*.sql")}
        assert source_files.keys() == deployed_files.keys(), (
            "Migration inventory mismatch: " + service
        )
        for name, path in source_files.items():
            assert path.read_bytes() == deployed_files[name].read_bytes(), (
                "Migration bytes differ: " + service + "/" + name
            )
        migration_inventory[service] = sorted(source_files)
        job = yaml.safe_load(
            read("infra/k8s/base/migrate-" + service + "-service.yaml")
        )
        job_container = job["spec"]["template"]["spec"]["containers"][0]
        assert "--editor.migrate-only=true" in job_container["args"]
        assert "--spring.flyway.enabled=true" in job_container["args"]
        assert job["spec"]["template"]["spec"]["restartPolicy"] == "Never"
    checks.extend(
        [
            "all authoritative migration bytes/inventories match service resources",
            "separate bounded migrate-only Jobs for all three database owners",
        ]
    )

    broker = compose["services"]["kafka"]["environment"]
    assert broker["KAFKA_ALLOW_EVERYONE_IF_NO_ACL_FOUND"] == "false"
    assert "ANONYMOUS" not in broker["KAFKA_SUPER_USERS"]
    assert "CONTROLLER:SASL_PLAINTEXT" in broker["KAFKA_LISTENER_SECURITY_PROTOCOL_MAP"]
    assert (
        "KAFKA_PASSWORD" not in compose["services"]["identity-service"]["environment"]
    )
    ci = read(".github/workflows/ci.yml")
    assert "!reports/raw/**" in ci
    assert "python scripts/run.py test" in ci and "npm run build" in ci
    quality = read("scripts/run.py")
    for gate in (
        "java_imports.py",
        "pom_format.py",
        "format:check",
        "architecture",
        "typecheck",
        "lint",
        "next-lint-glob.test.mjs",
        "gateway.test.mjs",
    ):
        assert gate in quality, "Missing CI quality gate: " + gate
    cloud = yaml.safe_load(read("infra/gcp/compose.cloud.yaml"))
    caddy = cloud["services"]["https"]["volumes"][0].split(":", 1)[0]
    assert (ROOT / "infra/compose" / caddy).resolve().is_file()
    checks.extend(
        [
            "Kafka service ACL/auth configuration, authenticated controller and no Identity principal",
            "CI enforces formatting/import/type/lint/architecture/tests/build and excludes protected backup secrets",
            "cloud Compose TLS bind resolves relative to base Compose file",
        ]
    )

    deploy = read(".github/workflows/cloud-deploy.yml")
    assert (
        "workflow_dispatch:" in deploy and "github.ref == 'refs/heads/main'" in deploy
    )
    assert "environment: cloud-lab" in deploy
    assert (
        deploy.index("kubectl create --dry-run=server")
        < deploy.index("kubectl apply -f cloud-render/migrations.yaml")
        < deploy.index("kubectl apply -f cloud-render/applications.yaml")
    )
    assert "previous-digests.txt" in deploy and "GCP_DEPLOY_SERVICE_ACCOUNT" in deploy
    assert "terraform apply" not in deploy
    assert "loadConfig(process.env)" in deploy and "vars.TRUSTED_PROXY_CIDRS" in deploy
    publish = read(".github/workflows/cloud-images.yml")
    assert publish.index("python checks/image_secrets.py") < publish.index(
        "docker push"
    )
    assert publish.index(
        "python checks/image_os_scan.py --download-db"
    ) < publish.index("docker push")
    for path in (ROOT / ".github/workflows").glob("*.yml"):
        yaml.safe_load(path.read_text(encoding="utf-8"))
    checks.extend(
        [
            "manual protected digest deployment, separate migration validation/jobs, captured rollback digests and validated persistent proxy trust; workflow YAML parses",
            "exact rebuilt cloud images require secret/OS scans before publication",
        ]
    )

    optional = list(yaml.safe_load_all(read("infra/k8s/ingress.example.yaml")))
    backend = resource(optional, "BackendConfig", "editor-web")
    assert backend["spec"]["timeoutSec"] == 130
    assert backend["spec"]["connectionDraining"]["drainingTimeoutSec"] == 30
    assert backend["spec"]["healthCheck"] == {
        "type": "HTTP",
        "requestPath": "/healthz",
        "port": 8080,
    }
    checks.append("optional GKE BackendConfig aligns timeout/drain/health with gateway")
    report = {
        "status": "PASS",
        "completedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "scope": "offline rendering and artifact assertions only; gateway behavior has separate real HTTP/process contracts",
        "checks": checks,
        "migrationInventory": migration_inventory,
        "cloud": "DEPLOY_PENDING; no credentials, cluster schema/API dry-run or deployment attempted",
    }
    (ROOT / "reports/deployment-static.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(checks))


if __name__ == "__main__":
    main()
