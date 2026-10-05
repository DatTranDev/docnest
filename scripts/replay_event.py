#!/usr/bin/env python3
"""Validate an original event envelope; dry-run by default, publish only with --publish.

Redacted DLQ entries cannot reconstruct invalid original envelopes. Obtain a corrected,
reviewed envelope from the service's durable outbox; retain its eventId. Never log bodies.
"""

import argparse, json, pathlib, subprocess, sys
from jsonschema import Draft202012Validator, FormatChecker

ROOT = pathlib.Path(__file__).resolve().parents[1]
TOPICS = (
    "document.version.saved.v1",
    "processing.job.requested.v1",
    "processing.job.completed.v1",
)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def validate(topic, raw):
    if topic not in TOPICS:
        raise ValueError("Business topic is not allowlisted")
    if len(raw) > 65536:
        raise ValueError("Event exceeds the 64 KiB cap")
    event = json.loads(
        raw.decode("utf-8"),
        object_pairs_hook=unique_object,
        parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Non-finite number")),
    )
    schema = json.loads(
        (ROOT / "contracts/events" / (topic + ".schema.json")).read_text(
            encoding="utf-8"
        )
    )
    if next(
        Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(event),
        None,
    ):
        raise ValueError("Event schema validation failed")
    wire = json.dumps(
        event, ensure_ascii=False, separators=(",", ":"), allow_nan=False
    ).encode("utf-8")
    if len(wire) > 65536:
        raise ValueError("Serialized event exceeds cap")
    return event, wire


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--topic", choices=TOPICS, required=True)
    parser.add_argument("--file", type=pathlib.Path, required=True)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--dry-run", action="store_true")
    group.add_argument("--publish", action="store_true")
    parser.add_argument(
        "--container", help="Explicit Kafka container name; otherwise local Compose"
    )
    args = parser.parse_args()
    try:
        if args.file.stat().st_size > 65536:
            raise ValueError("Event exceeds cap")
        event, wire = validate(args.topic, args.file.read_bytes())
    except (OSError, ValueError, UnicodeError):
        raise SystemExit(
            "REJECTED: original event is unreadable or invalid; payload withheld"
        )
    summary = {"topic": args.topic, "eventId": event["eventId"], "bytes": len(wire)}
    if not args.publish:
        print(json.dumps({"operation": "DRY_RUN", **summary}))
        return
    cli = [
        "/opt/kafka/bin/kafka-console-producer.sh",
        "--bootstrap-server",
        "localhost:9092",
        "--producer.config",
        "/tmp/editor-kafka/operator.properties",
        "--topic",
        args.topic,
        "--property",
        "parse.key=true",
        "--property",
        "key.separator=\t",
        "--producer-property",
        "acks=all",
        "--producer-property",
        "max.block.ms=5000",
        "--producer-property",
        "request.timeout.ms=5000",
        "--producer-property",
        "delivery.timeout.ms=10000",
    ]
    if args.container:
        command = ["docker", "exec", "-i", args.container] + cli
    else:
        command = [
            "docker",
            "compose",
            "--env-file",
            str(ROOT / ".env"),
            "-f",
            str(ROOT / "infra/compose/compose.yaml"),
            "exec",
            "-T",
            "kafka",
        ] + cli
    try:
        sent = subprocess.run(
            command,
            input=event["payload"]["documentId"].encode("ascii") + b"\t" + wire + b"\n",
            capture_output=True,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise SystemExit(
            "PUBLISH_UNCONFIRMED: retry the same eventId after inspecting the broker"
        )
    if sent.returncode or b"ERROR" in sent.stderr or b"Exception" in sent.stderr:
        raise SystemExit(
            "PUBLISH_UNCONFIRMED: protected producer output withheld; retain eventId on retry"
        )
    print(json.dumps({"operation": "PUBLISHED", **summary}))


if __name__ == "__main__":
    main()
