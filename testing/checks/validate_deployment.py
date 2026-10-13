"""Offline deployment assertions; these do not replace cluster or cloud smoke tests."""

import datetime
import json
import pathlib
import subprocess
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[2]
APPLICATIONS = (
    "identity-service",
    "document-service",
    "processing-service",
    "collaboration-service",
    "payment-service",
    "web",
)


def read(relative):
    return (ROOT / relative).read_text(encoding="utf-8")


def resource(objects, kind, name):
    return next(
        item
        for item in objects
        if item["kind"] == kind and item["metadata"]["name"] == name
    )


def ci_modes():
    workflow = yaml.load(read(".github/workflows/ci.yml"), Loader=yaml.BaseLoader)
    inputs = workflow["on"]["workflow_call"]["inputs"]
    assert inputs["runtime_checks"]["default"] == "false"
    assert inputs["full_acceptance"]["default"] == "false"
    assert (
        workflow["on"]["workflow_dispatch"]["inputs"]["full_acceptance"]["default"]
        == "false"
    )
    steps = {
        step["run"]: step
        for step in workflow["jobs"]["application"]["steps"]
        if "run" in step
    }
    for core in (
        "python tooling/scripts/run.py test",
        "npm run build",
        "npm run build:local",
        "python testing/checks/validate_deployment.py",
        "python testing/checks/dependency_scan.py",
        "python testing/checks/scan_secrets.py",
    ):
        assert not steps[core].get("if"), "Core gate must run in every mode: " + core
    for runtime in (
        "python testing/checks/mysql_bootstrap_check.py",
        "python tooling/scripts/run.py up",
        "python testing/checks/migration_only.py",
        "python tooling/scripts/run.py smoke",
        "npm run worker-check",
    ):
        assert steps[runtime]["if"] == "inputs.runtime_checks || inputs.full_acceptance"
    browser_steps = [key for key in steps if "-browser.cjs" in key]
    assert len(browser_steps) == 7
    for acceptance in (*browser_steps, "python testing/checks/billing_saga_check.py"):
        assert steps[acceptance]["if"] == "inputs.full_acceptance"
    assert steps["python tooling/scripts/run.py down"]["if"] == (
        "always() && (inputs.runtime_checks || inputs.full_acceptance)"
    )
    publish = yaml.load(
        read(".github/workflows/cloud-images.yml"), Loader=yaml.BaseLoader
    )
    assert publish["jobs"]["validate"]["uses"] == "./.github/workflows/ci.yml"
    assert publish["jobs"]["validate"]["with"]["runtime_checks"] == "true"
    assert publish["jobs"]["images"]["needs"] == "validate"


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
    gateway = read("frontend/web/server/gateway.mjs")
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
        ("COLLABORATION_INTERNAL_ORIGIN", "collaboration-service"),
        ("PAYMENT_INTERNAL_ORIGIN", "payment-service"),
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
        "COPY tooling/lint-glob ./tooling/lint-glob",
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

    event_schemas = {
        path.name: path.read_bytes()
        for path in (ROOT / "docs/contracts/events").glob("*.schema.json")
    }
    assert event_schemas, "Authoritative event schemas missing"
    for owner in ("common", "processing-service"):
        packaged = ROOT / "backend" / owner / "src/main/resources/contracts/events"
        assert {
            path.name: path.read_bytes() for path in packaged.glob("*.schema.json")
        } == event_schemas, ("Packaged event schema differs from contract: " + owner)
    checks.append("packaged event schema bytes match authoritative contracts")

    migration_inventory = {}
    for service in ("identity", "document", "processing", "collaboration", "payment"):
        schema = ROOT / "backend/schema" / service
        deployed = (
            ROOT
            / "backend"
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
            "separate bounded migrate-only Jobs for all five database owners",
        ]
    )

    broker = compose["services"]["kafka"]["environment"]
    assert broker["KAFKA_ALLOW_EVERYONE_IF_NO_ACL_FOUND"] == "false"
    assert "ANONYMOUS" not in broker["KAFKA_SUPER_USERS"]
    assert "CONTROLLER:SASL_PLAINTEXT" in broker["KAFKA_LISTENER_SECURITY_PROTOCOL_MAP"]
    assert (
        compose["services"]["identity-service"]["environment"]["KAFKA_USERNAME"]
        == "identity"
    )
    ci = read(".github/workflows/ci.yml")
    assert "python tooling/scripts/run.py test" in ci and "npm run build" in ci
    assert "npm run worker-check" in ci and "migration_only.py" in ci
    assert "billing_saga_check.py" in ci
    assert "terraform -chdir=infra/gcp test" in ci
    assert "workflow_dispatch:" in ci
    assert "init -backend=false -input=false -lockfile=readonly" in ci
    assert "actions/upload-artifact" not in ci
    ci_modes()
    quality = read("tooling/scripts/run.py")
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
            "Kafka service ACL/auth configuration, authenticated controller and five independent service principals",
            "CI core gates always run; cloud builds require runtime/migration/smoke/Worker checks; full browser/billing acceptance is opt-in",
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
        < deploy.index("kubectl apply -f cloud-render/backends.yaml")
        < deploy.index("kubectl apply -f cloud-render/web.yaml")
    )
    assert "previous-digests.txt" in deploy and "GCP_DEPLOY_SERVICE_ACCOUNT" in deploy
    assert "terraform apply" not in deploy
    assert "loadConfig(process.env)" in deploy and "vars.TRUSTED_PROXY_CIDRS" in deploy
    assert (
        deploy.index("kubectl apply --dry-run=server -f cloud-render/config.yaml")
        < deploy.index("kubectl apply -f cloud-render/config.yaml")
        < deploy.index("kubectl apply -f cloud-render/migrations.yaml")
    )
    assert "--google-client-id" in deploy and "--stripe-pro-monthly-price" in deploy
    role = yaml.safe_load_all(read("infra/k8s/deploy-rbac.example.yaml"))
    rules = next(role)["rules"]
    config_rule = next(rule for rule in rules if rule["resources"] == ["configmaps"])
    assert config_rule["resourceNames"] == ["editor-config"]
    assert set(config_rule["verbs"]) == {"get", "patch", "update"}
    assert all("secrets" not in rule["resources"] for rule in rules)
    publish = read(".github/workflows/cloud-images.yml")
    assert "NEXT_PUBLIC_GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID" in publish
    assert "vars.GOOGLE_CLIENT_ID" in publish
    assert "Check cloud build configuration" in publish
    assert "cloud-release.json" in publish and "GITHUB_STEP_SUMMARY" in publish
    assert publish.index("python testing/checks/image_secrets.py") < publish.index(
        "docker push"
    )
    assert publish.index(
        "python testing/checks/image_os_scan.py --download-db"
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
    ingress = resource(optional, "Ingress", "editor-public")
    assert ingress["metadata"]["annotations"].get(
        "kubernetes.io/ingress.allow-http"
    ) not in (
        "false",
        False,
    ), "Initial managed-certificate provisioning needs the HTTP frontend"
    backend = resource(optional, "BackendConfig", "editor-web")
    assert backend["spec"]["timeoutSec"] == 130
    assert backend["spec"]["connectionDraining"]["drainingTimeoutSec"] == 30
    assert backend["spec"]["healthCheck"] == {
        "type": "HTTP",
        "requestPath": "/healthz",
        "port": 8080,
    }
    checks.append("optional GKE BackendConfig aligns timeout/drain/health with gateway")
    subprocess.run(
        [sys.executable, str(ROOT / "testing/checks/cloud_preparation_check.py")],
        check=True,
    )
    subprocess.run(
        [sys.executable, str(ROOT / "testing/checks/vm_release_check.py")],
        check=True,
    )
    checks.append(
        "actual offline Compose/Kustomize configuration, six digests, five migrations, optional providers and invalid-input rejection"
    )
    report = {
        "status": "PASS",
        "completedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "scope": "offline rendering and artifact assertions only; gateway behavior has separate real HTTP/process contracts",
        "checks": checks,
        "migrationInventory": migration_inventory,
        "cloud": "DEPLOY_PENDING; no credentials, cluster schema/API dry-run or deployment attempted",
    }
    (ROOT / "testing/reports").mkdir(parents=True, exist_ok=True)
    (ROOT / "testing/reports/deployment-static.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(checks))


if __name__ == "__main__":
    main()
