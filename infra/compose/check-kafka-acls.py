#!/usr/bin/env python3
"""Exercise the real SASL/ACL matrix on an isolated local Kafka broker; never prints secrets/payloads."""

import json, os, pathlib, secrets, subprocess, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[2]
NAME = "editor-kafka-acl-check-" + secrets.token_hex(4)
IMAGE = "apache/kafka:4.1.1@sha256:0bc1bb2478f45b6cea78864df86acdc11e8df2c5172477819a4d12942cbe5d40"
REPORT = ROOT / "testing/reports/kafka-acl-check.json"
results = []


def run(args, **kwargs):
    return subprocess.run(
        args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, **kwargs
    )


def inside(*args, input=None, timeout=30):
    return run(
        ["docker", "exec", "-i", "-e", "KAFKA_HEAP_OPTS=-Xms32m -Xmx128m", NAME, *args],
        input=input,
        timeout=timeout,
    )


def consumer(user, topic, group):
    return inside(
        "/opt/kafka/bin/kafka-console-consumer.sh",
        "--bootstrap-server",
        "localhost:9092",
        "--consumer.config",
        f"/tmp/editor-kafka/{user}.properties",
        "--topic",
        topic,
        "--group",
        group,
        "--from-beginning",
        "--max-messages",
        "1",
        "--timeout-ms",
        "5000",
        timeout=15,
    )


def producer(user, topic):
    return inside(
        "/opt/kafka/bin/kafka-console-producer.sh",
        "--bootstrap-server",
        "localhost:9092",
        "--producer.config",
        f"/tmp/editor-kafka/{user}.properties",
        "--topic",
        topic,
        input="ACL_PROBE\n",
        timeout=15,
    )


def check(name, condition):
    results.append({"name": name, "passed": bool(condition)})
    if not condition:
        raise RuntimeError(name + " failed; protected output withheld")


def main():
    REPORT.parent.mkdir(exist_ok=True)
    descriptor, path = tempfile.mkstemp(
        prefix="editor-kafka-auth-", suffix=".env", dir=ROOT / ".tools"
    )
    os.close(descriptor)
    password_file = pathlib.Path(path)
    env = {
        k: secrets.token_hex(32)
        for k in [
            "KAFKA_BROKER_PASSWORD",
            "KAFKA_ADMIN_PASSWORD",
            "KAFKA_DOCUMENT_PASSWORD",
            "KAFKA_PROCESSING_PASSWORD",
            "KAFKA_OPERATOR_PASSWORD",
        ]
    }
    env.update(
        {
            "CLUSTER_ID": "MkU3OEVBNTcwNTJENDM2Qk",
            "KAFKA_NODE_ID": "1",
            "KAFKA_PROCESS_ROLES": "broker,controller",
            "KAFKA_LISTENERS": "SASL_PLAINTEXT://:9092,CONTROLLER://:9093",
            "KAFKA_ADVERTISED_LISTENERS": "SASL_PLAINTEXT://localhost:9092",
            "KAFKA_LISTENER_SECURITY_PROTOCOL_MAP": "SASL_PLAINTEXT:SASL_PLAINTEXT,CONTROLLER:SASL_PLAINTEXT",
            "KAFKA_CONTROLLER_LISTENER_NAMES": "CONTROLLER",
            "KAFKA_INTER_BROKER_LISTENER_NAME": "SASL_PLAINTEXT",
            "KAFKA_CONTROLLER_QUORUM_VOTERS": "1@localhost:9093",
            "KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR": "1",
            "KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR": "1",
            "KAFKA_TRANSACTION_STATE_LOG_MIN_ISR": "1",
            "KAFKA_AUTO_CREATE_TOPICS_ENABLE": "false",
            "KAFKA_SASL_ENABLED_MECHANISMS": "PLAIN",
            "KAFKA_SASL_MECHANISM_INTER_BROKER_PROTOCOL": "PLAIN",
            "KAFKA_SASL_MECHANISM_CONTROLLER_PROTOCOL": "PLAIN",
            "KAFKA_AUTHORIZER_CLASS_NAME": "org.apache.kafka.metadata.authorizer.StandardAuthorizer",
            "KAFKA_ALLOW_EVERYONE_IF_NO_ACL_FOUND": "false",
            "KAFKA_SUPER_USERS": "User:broker;User:admin",
            "KAFKA_HEAP_OPTS": "-Xms128m -Xmx384m",
        }
    )
    password_file.write_text(
        "".join(k + "=" + v + "\n" for k, v in env.items()), encoding="utf-8"
    )
    if os.name != "nt":
        password_file.chmod(0o600)
    try:
        started = run(
            [
                "docker",
                "run",
                "-d",
                "--name",
                NAME,
                "--memory",
                "768m",
                "--env-file",
                str(password_file),
                "-v",
                str(ROOT / "infra/compose") + ":/opt/editor-kafka:ro",
                IMAGE,
                "bash",
                "/opt/editor-kafka/kafka-start.sh",
            ],
            timeout=20,
        )
        check("isolated_broker_started", started.returncode == 0)
        deadline = time.monotonic() + 120
        ready = False
        while time.monotonic() < deadline:
            ready = (
                inside(
                    "/opt/kafka/bin/kafka-broker-api-versions.sh",
                    "--bootstrap-server",
                    "localhost:9092",
                    "--command-config",
                    "/tmp/editor-kafka/admin.properties",
                    timeout=15,
                ).returncode
                == 0
            )
            if ready:
                break
            time.sleep(2)
        check("sasl_admin_ready", ready)
        setup = inside("bash", "/opt/editor-kafka/kafka-init-acls.sh", timeout=180)
        check("topics_and_acls_configured", setup.returncode == 0)
        check(
            "document_can_publish_saved",
            producer("document", "document.version.saved.v1").returncode == 0,
        )
        allowed = consumer(
            "processing", "document.version.saved.v1", "processing-preview-v1"
        )
        check(
            "processing_can_read_saved",
            allowed.returncode == 0 and "ACL_PROBE" in allowed.stdout,
        )
        check(
            "processing_can_publish_completed",
            producer("processing", "processing.job.completed.v1").returncode == 0,
        )
        allowed = consumer(
            "document", "processing.job.completed.v1", "document-preview-projection-v1"
        )
        check(
            "document_can_read_completed",
            allowed.returncode == 0 and "ACL_PROBE" in allowed.stdout,
        )
        denied = consumer(
            "document", "document.version.saved.v1", "document-preview-projection-v1"
        )
        check(
            "document_cannot_read_saved",
            (
                "TopicAuthorizationException" in denied.stderr + denied.stdout
                or "Not authorized to access topics" in denied.stderr + denied.stdout
            )
            and "ACL_PROBE" not in denied.stdout,
        )
        denied = consumer(
            "processing", "processing.job.completed.v1", "processing-preview-v1"
        )
        check(
            "processing_cannot_read_completed",
            (
                "TopicAuthorizationException" in denied.stderr + denied.stdout
                or "Not authorized to access topics" in denied.stderr + denied.stdout
            )
            and "ACL_PROBE" not in denied.stdout,
        )
        denied = consumer("processing", "document.version.saved.v1", "foreign-group")
        check(
            "processing_cannot_use_foreign_group",
            (
                "GroupAuthorizationException" in denied.stderr + denied.stdout
                or "Not authorized to access group" in denied.stderr + denied.stdout
            )
            and "ACL_PROBE" not in denied.stdout,
        )
        inside(
            "bash",
            "-c",
            'printf "%s\\n" "security.protocol=SASL_PLAINTEXT" "sasl.mechanism=PLAIN" \'sasl.jaas.config=org.apache.kafka.common.security.plain.PlainLoginModule required username="processing" password="wrong-test-password";\' > /tmp/editor-kafka/wrong.properties',
            timeout=5,
        )
        denied = consumer("wrong", "document.version.saved.v1", "processing-preview-v1")
        check(
            "wrong_password_rejected",
            (
                "SaslAuthenticationException" in denied.stderr + denied.stdout
                or "Invalid username or password" in denied.stderr + denied.stdout
            )
            and "ACL_PROBE" not in denied.stdout,
        )
        anonymous = inside(
            "/opt/kafka/bin/kafka-console-consumer.sh",
            "--bootstrap-server",
            "localhost:9092",
            "--topic",
            "document.version.saved.v1",
            "--group",
            "processing-preview-v1",
            "--from-beginning",
            "--timeout-ms",
            "3000",
            timeout=15,
        )
        logs = run(["docker", "logs", NAME], timeout=10)
        handshake_rejected = "during SASL handshake" in logs.stdout + logs.stderr
        check(
            "anonymous_cannot_read",
            handshake_rejected and "ACL_PROBE" not in anonymous.stdout,
        )
    finally:
        run(["docker", "rm", "-f", NAME], timeout=15)
        password_file.unlink(missing_ok=True)
        REPORT.write_text(
            json.dumps(
                {
                    "scope": "isolated real Kafka 4.1.1 SASL_PLAIN/StandardAuthorizer checks; no cloud resources",
                    "checks": results,
                    "passed": len(results) > 0 and all(r["passed"] for r in results),
                },
                indent=2,
            ),
            encoding="utf-8",
        )
    print(f"{len(results)} Kafka authentication/ACL checks passed. Evidence: {REPORT}")


if __name__ == "__main__":
    main()
