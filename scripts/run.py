#!/usr/bin/env python3
"""Cross-platform local commands. Never invokes Google Cloud or enables billing."""

import argparse, json, os, pathlib, secrets, subprocess, sys, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
os.chdir(ROOT)
ENV = ROOT / ".env"


def execute(args, **kwargs):
    print("+ " + " ".join(map(str, args)), flush=True)
    return subprocess.run(list(map(str, args)), check=True, **kwargs)


def initialize():
    if not ENV.exists():
        text = (ROOT / ".env.example").read_text(encoding="utf-8")
        text = text.replace("REPLACE_LOCAL_RANDOM", "{}")
        for _ in range(text.count("{}")):
            text = text.replace("{}", secrets.token_hex(32), 1)
        ENV.write_text(text, encoding="utf-8")
        if os.name != "nt":
            ENV.chmod(0o600)
    values = {}
    for line in ENV.read_text(encoding="utf-8").splitlines():
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            values[k] = v
    # Upgrade existing local environments without rotating persisted DB credentials.
    missing = {
        k: secrets.token_hex(32)
        for k in [
            "KAFKA_BROKER_PASSWORD",
            "KAFKA_ADMIN_PASSWORD",
            "KAFKA_DOCUMENT_PASSWORD",
            "KAFKA_PROCESSING_PASSWORD",
            "KAFKA_OPERATOR_PASSWORD",
        ]
        if not values.get(k)
    }
    if missing:
        with ENV.open("a", encoding="utf-8") as f:
            f.write("\n" + "\n".join(k + "=" + v for k, v in missing.items()) + "\n")
        values.update(missing)
    return values


def compose(*args, debug=False, **kwargs):
    cmd = [
        "docker",
        "compose",
        "--env-file",
        str(ENV),
        "-f",
        "infra/compose/compose.yaml",
    ]
    if debug:
        cmd += ["-f", "infra/compose/debug.yaml"]
    return execute(cmd + list(args), **kwargs)


def topics(debug=False):
    compose(
        "exec",
        "-T",
        "kafka",
        "bash",
        "/opt/editor-kafka/kafka-init-acls.sh",
        debug=debug,
    )


def java_env():
    env = os.environ.copy()
    # Optional workspace JDK does not replace the user's installed JDK.
    candidates = list((ROOT / ".tools/jdk").glob("jdk-21*"))
    if candidates:
        env["JAVA_HOME"] = str(candidates[0])
        env["PATH"] = str(candidates[0] / "bin") + os.pathsep + env["PATH"]
    env["PYTHONUTF8"] = "1"
    env.setdefault(
        "MAVEN_OPTS",
        "-Xms64m -Xmx384m -XX:ActiveProcessorCount=2 -XX:ReservedCodeCacheSize=128m",
    )
    return env


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "command",
        choices=[
            "up",
            "infra-up",
            "down",
            "build",
            "test",
            "format",
            "quality",
            "contracts",
            "smoke",
            "benchmark",
            "e2e",
            "infra-check",
            "backup",
            "restore",
        ],
    )
    p.add_argument("--backup-path", default="reports/raw/backup")
    p.add_argument("--confirm-restore", action="store_true")
    a = p.parse_args()
    initialize()
    npm = "npm.cmd" if os.name == "nt" else "npm"
    mvn = "mvnw.cmd" if os.name == "nt" else "./mvnw"
    if a.command in ["up", "infra-up"]:
        debug = a.command == "infra-up"
        compose(
            "up",
            "-d",
            "--wait",
            "--wait-timeout",
            "240",
            "mysql",
            "kafka",
            "redis",
            debug=debug,
        )
        topics(debug)
        if not debug:
            for service in [
                "identity-service",
                "document-service",
                "processing-service",
                "web",
            ]:
                compose("--profile", "app", "build", service)
            compose(
                "--profile",
                "app",
                "up",
                "-d",
                "--no-build",
                "--wait",
                "--wait-timeout",
                "360",
            )
        print(
            "Application: http://localhost:8080"
            if not debug
            else "Local infrastructure ready on localhost:3306,19092,6379"
        )
    elif a.command == "down":
        compose("--profile", "app", "down", "--remove-orphans")
    elif a.command == "build":
        execute([mvn, "-B", "-ntp", "package"], env=java_env())
        execute([npm, "ci"])
        execute([npm, "run", "build"])
    elif a.command == "test":
        execute([sys.executable, "-X", "utf8", "checks/validate_kit.py"])
        execute([sys.executable, "-X", "utf8", "checks/validate_contracts.py"])
        quality(npm)
        execute([mvn, "-B", "-ntp", "verify"], env=java_env())
        execute([npm, "test"])
    elif a.command == "quality":
        quality(npm)
        execute([mvn, "-B", "-ntp", "spotless:check"], env=java_env())
    elif a.command == "format":
        execute(
            [
                sys.executable,
                "-m",
                "black",
                "scripts",
                "checks",
                "fixtures",
                "infra",
                "apps/web/benchmark",
            ]
        )
        execute([sys.executable, "-X", "utf8", "checks/pom_format.py", "--write"])
        execute([mvn, "-B", "-ntp", "spotless:apply"], env=java_env())
        execute([npm, "run", "format:write"])
    elif a.command == "contracts":
        execute([sys.executable, "-X", "utf8", "checks/validate_contracts.py"])
    elif a.command == "smoke":
        execute([sys.executable, "-X", "utf8", "checks/smoke.py"])
    elif a.command == "infra-check":
        execute([sys.executable, "-X", "utf8", "checks/infra_checks.py"])
    elif a.command in ["benchmark", "e2e"]:
        if a.command == "benchmark":
            execute(
                [
                    sys.executable,
                    "-X",
                    "utf8",
                    "fixtures/generate_fixtures.py",
                    "--large",
                    "--output",
                    "fixtures/large",
                ]
            )
        execute([npm, "run", a.command])
    elif a.command in ["backup", "restore"]:
        path = pathlib.Path(a.backup_path).resolve()
        if a.command == "backup":
            path.mkdir(parents=True, exist_ok=True)
            raw = compose(
                "--profile",
                "app",
                "ps",
                "--format",
                "json",
                capture_output=True,
                text=True,
            ).stdout.strip()
            rows = (
                json.loads(raw)
                if raw.startswith("[")
                else [json.loads(line) for line in raw.splitlines() if line]
            )
            running = [
                row["Service"]
                for row in rows
                if row["Service"]
                in ["identity-service", "document-service", "processing-service", "web"]
                and row["State"] == "running"
            ]
            if running:
                compose("stop", *running)
            try:
                with (path / "databases.sql").open("wb") as f:
                    compose(
                        "exec",
                        "-T",
                        "mysql",
                        "bash",
                        "-c",
                        'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction --routines --events --set-gtid-purged=OFF --databases identity_db document_db processing_db',
                        stdout=f,
                    )
                # Quiesced immutable objects and JWT keys make SQL references recoverable.
                for service, source, name in [
                    ("document-service", "/data/objects", "objects"),
                    ("identity-service", "/data/keys", "keys"),
                ]:
                    (path / name).mkdir(parents=True, exist_ok=True)
                    compose("cp", f"{service}:{source}/.", str(path / name))
                (path / "manifest.json").write_text(
                    json.dumps(
                        {
                            "createdAt": time.strftime(
                                "%Y-%m-%dT%H:%M:%SZ", time.gmtime()
                            ),
                            "scope": "three databases, objects and JWT keys",
                            "quiesced": True,
                        },
                        indent=2,
                    )
                )
            finally:
                if running:
                    compose(
                        "--profile",
                        "app",
                        "up",
                        "-d",
                        "--no-build",
                        "--no-deps",
                        "--wait",
                        "--wait-timeout",
                        "120",
                        *running,
                    )
        else:
            if not a.confirm_restore:
                raise SystemExit(
                    "Restore replaces local data. Review the backup and provide --confirm-restore."
                )
            if not (path / "databases.sql").is_file():
                raise SystemExit("Backup missing databases.sql")
            compose(
                "stop",
                "identity-service",
                "document-service",
                "processing-service",
                "web",
            )
            with (path / "databases.sql").open("rb") as f:
                compose(
                    "exec",
                    "-T",
                    "mysql",
                    "bash",
                    "-c",
                    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot',
                    stdin=f,
                )
            for service, name, target in [
                ("document-service", "objects", "/data/objects"),
                ("identity-service", "keys", "/data/keys"),
            ]:
                compose("cp", str(path / name) + os.sep + ".", f"{service}:{target}")
            for service in ["document-service", "identity-service"]:
                compose(
                    "run",
                    "--rm",
                    "--no-deps",
                    "--user",
                    "root",
                    "--entrypoint",
                    "chown",
                    service,
                    "-R",
                    "10001:10001",
                    "/data",
                )
            compose(
                "start",
                "identity-service",
                "document-service",
                "processing-service",
                "web",
            )


def quality(npm):
    execute(
        [
            sys.executable,
            "-m",
            "black",
            "--check",
            "scripts",
            "checks",
            "fixtures",
            "infra",
            "apps/web/benchmark",
        ]
    )
    execute([sys.executable, "-X", "utf8", "checks/java_imports.py"])
    execute([sys.executable, "-X", "utf8", "checks/pom_format.py"])
    for gate in ["format:check", "architecture", "typecheck", "lint"]:
        execute([npm, "run", gate])
    execute(
        [
            "node",
            "--test",
            "checks/next-lint-glob.test.mjs",
            "apps/web/server/gateway.test.mjs",
        ]
    )
    execute(["node", "checks/source-sizes.mjs"], env=java_env())


if __name__ == "__main__":
    main()
