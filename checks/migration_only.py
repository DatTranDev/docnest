"""Run current local app images through cloud-profile Flyway-only entry points.

Requires the healthy full local Compose application. Uses only each service's own
database credentials, does not print them, and creates no cloud resources. Runtime
key/storage/broker settings are deliberately unusable to detect accidental Spring
application initialization. Existing Flyway history must remain unchanged.
"""

import datetime
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from run import initialize

SERVICES = ("identity", "document", "processing")
REPORT = ROOT / "reports" / "migration-only.json"
COMPOSE = [
    "docker",
    "compose",
    "--env-file",
    str(ROOT / ".env"),
    "-f",
    "infra/compose/compose.yaml",
    "--profile",
    "app",
]
RUNTIME_MARKERS = re.compile(
    r"::\s*Spring Boot\s*::|Starting \w+Application|Tomcat started|"
    r"org\.apache\.kafka|KafkaProducer|ConsumerConfig|RedisConnection|"
    r"Application run failed|GcsStorage|RsaTokenIssuer",
    re.IGNORECASE,
)
PROBE_ENVIRONMENT = {
    "SPRING_PROFILES_ACTIVE": "cloud",
    "JWT_ALLOW_KEY_GENERATION": "false",
    "JWT_KEY_PATH": "/migration-probe/no-signing-key.pem",
    "GOOGLE_APPLICATION_CREDENTIALS": "/migration-probe/no-google-credentials.json",
    "STORAGE_PROVIDER": "GCS",
    "GCS_SNAPSHOTS_BUCKET": "migration-probe-unconfigured-snapshots",
    "SNAPSHOTS_BUCKET": "migration-probe-unconfigured-snapshots",
    "GCS_RESULTS_BUCKET": "migration-probe-unconfigured-results",
    "GCS_BUCKET": "migration-probe-unconfigured-results",
    "IDENTITY_BASE_URL": "http://127.0.0.1:1",
    "DOCUMENT_URL": "http://127.0.0.1:1",
    "JWT_JWK_URI": "http://127.0.0.1:1/.well-known/jwks.json",
    "KAFKA_BOOTSTRAP_SERVERS": "127.0.0.1:1",
    "SPRING_KAFKA_BOOTSTRAP_SERVERS": "127.0.0.1:1",
    "REDIS_HOST": "unavailable.invalid",
    "SPRING_DATA_REDIS_HOST": "unavailable.invalid",
}


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def invoke(arguments, timeout=30):
    return subprocess.run(
        arguments,
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )


def checked(arguments):
    result = invoke(arguments)
    if result.returncode:
        raise RuntimeError("Local Docker/SQL prerequisite failed")
    return result.stdout


def source_hashes(service):
    paths = [ROOT / "pom.xml", ROOT / "infra/compose/Service.Dockerfile"]
    for owner in ("common", service + "-service"):
        directory = ROOT / "services" / owner
        paths.append(directory / "pom.xml")
        paths.extend(
            path for path in (directory / "src/main").rglob("*") if path.is_file()
        )
    return {
        str(path.relative_to(ROOT))
        .replace("\\", "/"): hashlib.sha256(path.read_bytes())
        .hexdigest()
        for path in sorted(paths)
    }


def history(service):
    password_name = service.upper() + "_DB_PASSWORD"
    query = (
        "SELECT installed_rank,version,description,type,script,checksum,success "
        "FROM flyway_schema_history ORDER BY installed_rank"
    )
    # Container env expands the password; its value never enters argv or output.
    shell = (
        'MYSQL_PWD="$'
        + password_name
        + '" exec mysql -u'
        + service
        + " -D"
        + service
        + '_db --batch --skip-column-names -e "$1"'
    )
    output = checked(
        COMPOSE
        + ["exec", "-T", "mysql", "bash", "-c", shell, "migration-history", query]
    )
    rows = []
    for line in output.splitlines():
        rank, version, description, kind, script, checksum, success = line.split("\t")
        rows.append(
            {
                "installedRank": int(rank),
                "version": version,
                "description": description,
                "type": kind,
                "script": script,
                "checksum": int(checksum),
                "success": success == "1",
            }
        )
    return rows


def redact(text, secrets):
    for value in secrets:
        text = text.replace(value, "[REDACTED]")
    return re.sub(
        r"-----BEGIN (?:RSA )?PRIVATE KEY-----.*?-----END (?:RSA )?PRIVATE KEY-----",
        "[REDACTED PRIVATE KEY]",
        text,
        flags=re.DOTALL,
    )


def main():
    values = initialize()
    secrets = [
        value
        for key, value in values.items()
        if key.endswith(("PASSWORD", "KEY")) and len(value) > 20
    ]
    report = {
        "status": "IN_PROGRESS",
        "startedAt": utc_now(),
        "cases": [],
        "scope": "three current local Docker app images; cloud profile against each own local MySQL database; no Google Cloud integration",
        "runtimeProbeEnvironment": PROBE_ENVIRONMENT,
        "cloud": "DEPLOY_PENDING; no credentials or resources used",
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    try:
        for service in SERVICES:
            name = service + "-service"
            case = {"service": name, "status": "IN_PROGRESS"}
            report["cases"].append(case)
            try:
                image = json.loads(
                    checked(
                        ["docker", "image", "inspect", "text-editor/" + name + ":local"]
                    )
                )[0]
                container = checked(COMPOSE + ["ps", "-q", name]).strip()
                if not container:
                    raise AssertionError(
                        "Required local application container is not running"
                    )
                running = json.loads(checked(["docker", "inspect", container]))[0]
                assert (
                    running["State"].get("Health", {}).get("Status") == "healthy"
                ), "Application prerequisite is not healthy"
                assert (
                    running["Image"] == image["Id"]
                ), "Running application differs from latest local image"
                case.update(
                    imageId=image["Id"],
                    imageCreatedAt=image["Created"],
                    sourceHashes=source_hashes(service),
                )
                before = history(service)
                migrations = sorted(
                    path.name for path in (ROOT / "schema" / service).glob("V*__*.sql")
                )
                assert [
                    row["script"] for row in before
                ] == migrations, "Installed migration inventory differs from source"
                assert all(
                    row["success"] for row in before
                ), "Unsuccessful prior Flyway history"
                argument = (
                    "--migrate-only"
                    if service == "identity"
                    else "--editor.migrate-only=true"
                )
                command = COMPOSE + ["run", "--rm", "--no-deps", "-T"]
                for key, value in PROBE_ENVIRONMENT.items():
                    command.extend(["-e", key + "=" + value])
                command.extend([name, argument])
                case["executionStartedAt"] = utc_now()
                start = time.perf_counter()
                result = invoke(command, timeout=120)
                elapsed = time.perf_counter() - start
                log = ROOT / "reports" / ("refactor-migration-" + name + ".log")
                output = result.stdout + result.stderr
                log.write_text(redact(output, secrets), encoding="utf-8")
                case.update(
                    exitCode=result.returncode,
                    elapsedSeconds=elapsed,
                    argument=argument,
                    log=str(log.relative_to(ROOT)).replace("\\", "/"),
                )
                assert (
                    result.returncode == 0
                ), "Migration-only process failed; see redacted log"
                assert re.search(
                    r"Successfully validated " + str(len(migrations)) + r" migrations",
                    output,
                ), "Flyway validation evidence missing"
                assert (
                    "is up to date. No migration necessary." in output
                ), "Existing migration history was not recognized"
                assert not RUNTIME_MARKERS.search(
                    output
                ), "Runtime application initialization appeared in migration logs"
                after = history(service)
                assert (
                    before == after
                ), "Migration-only rerun changed installed Flyway history"
                case.update(
                    status="PASS",
                    flywayInventory=after,
                    historyUnchanged=True,
                    runtimeStartupMarkersAbsent=True,
                    invalidRuntimeConfigurationAcceptedByMigrationPath=True,
                )
                print(
                    "PASS "
                    + name
                    + ": cloud-profile Flyway-only exit0, unchanged "
                    + str(len(after))
                    + " migrations",
                    flush=True,
                )
            except Exception as error:
                status = "FAIL" if case.get("executionStartedAt") else "NOT_RUN"
                case.update(status=status, error=redact(str(error), secrets))
                print(status + " " + name + ": " + case["error"], flush=True)
            REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        statuses = {case["status"] for case in report["cases"]}
        report["status"] = (
            "FAIL"
            if "FAIL" in statuses
            else "BLOCKED" if "NOT_RUN" in statuses else "PASS"
        )
    finally:
        report["completedAt"] = utc_now()
        REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
