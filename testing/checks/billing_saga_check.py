"""Real five-service SQL/Kafka saga gate. Stripe must be disabled.

Seeds only test entitlement intents, never customer/subscription IDs. This proves
local orchestration and transport; it does not prove Stripe sandbox payments.
Preserves app volumes and restores the smoke owner's entitlement to Free.
"""

import datetime
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import time
import uuid

import requests
from jsonschema import Draft202012Validator, FormatChecker

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tooling/scripts"))
from run import compose, initialize

BASE = os.environ.get("EDITOR_BASE_URL", "http://localhost:8080")
OWNERS = ("identity", "document", "processing", "collaboration")
CHECKS = []
TEST_EXPIRY = (
    datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=1)
).replace(microsecond=0)


def sql(owner, statement):
    # SQL arrives on stdin; credentials never enter process argv or reports.
    result = compose(
        "exec",
        "-T",
        "mysql",
        "bash",
        "-c",
        f'MYSQL_PWD="${owner.upper()}_DB_PASSWORD" exec mysql -u{owner} -D{owner}_db --batch --raw --skip-column-names',
        input=statement,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def call(session, method, path, expected=200, **kwargs):
    response = session.request(method, BASE + path, timeout=15, **kwargs)
    assert response.status_code in (
        expected if isinstance(expected, tuple) else (expected,)
    ), "Billing HTTP status mismatch"
    if response.content:
        return response.json()
    return None


def account():
    values = initialize()
    session = requests.Session()
    csrf = call(session, "GET", "/api/v1/auth/csrf")
    session.headers.update({"Origin": BASE, csrf["headerName"]: csrf["token"]})
    email = "smoke-owner@editor.test"
    password = hashlib.sha256(
        (values["MYSQL_ROOT_PASSWORD"] + email).encode()
    ).hexdigest()[:32]
    call(
        session,
        "POST",
        "/api/v1/auth/register",
        (201, 409),
        json={"email": email, "password": password, "displayName": "Smoke Owner"},
    )
    logged_in = call(
        session,
        "POST",
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    session.headers["Authorization"] = "Bearer " + logged_in["accessToken"]
    return session, str(uuid.UUID(logged_in["user"]["id"]))


def literal(value):
    # Generated UUID/constant/envelope only, not untrusted SQL or payment data.
    return "CONVERT(0x" + str(value).encode().hex() + " USING utf8mb4)"


def envelope(user, saga, generation, phase, plan):
    return {
        "eventId": str(uuid.uuid4()),
        "eventType": "EntitlementRequested",
        "schemaVersion": 1,
        "occurredAt": datetime.datetime.now(datetime.timezone.utc)
        .isoformat()
        .replace("+00:00", "Z"),
        "producer": "payment-service",
        "traceId": "4" * 32,
        "payload": {
            "userId": user,
            "sagaId": saga,
            "generation": generation,
            "phase": phase,
            "plan": plan,
            "expiresAt": (
                TEST_EXPIRY.isoformat().replace("+00:00", "Z")
                if plan != "FREE"
                else None
            ),
        },
    }


def insert_commands(user, saga, generation, plan):
    statements = []
    for owner in OWNERS:
        event = envelope(user, saga, generation, "APPLY", plan)
        schema = json.loads(
            (
                ROOT / f"docs/contracts/events/billing.{owner}.command.v1.schema.json"
            ).read_text(encoding="utf-8")
        )
        Draft202012Validator(schema, format_checker=FormatChecker()).validate(event)
        statements.append(
            "INSERT INTO saga_outbox(event_id,topic,aggregate_key,payload) VALUES("
            + ",".join(
                literal(v)
                for v in (
                    event["eventId"],
                    f"billing.{owner}.command.v1",
                    user,
                    json.dumps(event, separators=(",", ":")),
                )
            )
            + ");"
        )
    return "\n".join(statements)


def seed(user, plan):
    # Existing paid/Stripe account is forbidden: never mutate real billing state.
    protected = sql(
        "payment",
        f"SELECT COUNT(*) FROM payment_accounts WHERE user_id='{user}' AND (customer_id IS NOT NULL OR subscription_id IS NOT NULL OR plan NOT IN ('FREE','PRO_MONTHLY'));",
    )
    assert protected == "0", "Refusing to alter a Stripe-associated account"
    generations = [
        int(
            sql(
                o,
                f"SELECT COALESCE(MAX(generation),0) FROM subscription_entitlements WHERE user_id='{user}';",
            )
        )
        for o in OWNERS
    ]
    generations.append(
        int(
            sql(
                "payment",
                f"SELECT COALESCE(MAX(generation),0) FROM payment_accounts WHERE user_id='{user}';",
            )
        )
    )
    generation, saga = max(generations) + 1, str(uuid.uuid4())
    expiry = (
        literal(TEST_EXPIRY.strftime("%Y-%m-%d %H:%M:%S")) if plan != "FREE" else "NULL"
    )
    sql(
        "payment",
        f"""START TRANSACTION;
        INSERT INTO payment_accounts(user_id) VALUES('{user}') ON DUPLICATE KEY UPDATE user_id=user_id;
        SELECT user_id FROM payment_accounts WHERE user_id='{user}' FOR UPDATE;
        INSERT INTO payment_sagas(id,user_id,generation,plan,expires_at,previous_plan,previous_expires_at,trace_id)
        SELECT '{saga}',user_id,{generation},'{plan}',{expiry},plan,expires_at,'{'4' * 32}' FROM payment_accounts WHERE user_id='{user}';
        UPDATE payment_accounts SET generation={generation},saga_id='{saga}',review_needed=0 WHERE user_id='{user}';
        {insert_commands(user, saga, generation, plan)}
        COMMIT;""",
    )
    return saga, generation


def wait_saga(user, saga, state="COMPLETE", timeout=150):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        row = sql(
            "payment",
            f"SELECT state FROM payment_sagas WHERE id='{saga}' AND user_id='{user}';",
        )
        if row == state:
            return
        time.sleep(1)
    raise AssertionError("Saga failed to reach expected durable state")


def grants(user, plan, generation):
    for owner in OWNERS:
        assert (
            sql(
                owner,
                f"SELECT CONCAT(plan,':',generation) FROM subscription_entitlements WHERE user_id='{user}';",
            )
            == f"{plan}:{generation}"
        ), "Participant entitlement mismatch"


def note(message):
    CHECKS.append(message)
    print("PASS " + message, flush=True)


def probe(*args, **kwargs):
    kwargs.pop("check", None)
    try:
        return compose(*args, **kwargs)
    except subprocess.CalledProcessError as failure:
        return failure


def invalid_delivery(user):
    offsets = (
        compose(
            "exec",
            "-T",
            "kafka",
            "/opt/kafka/bin/kafka-get-offsets.sh",
            "--bootstrap-server",
            "localhost:9092",
            "--command-config",
            "/tmp/editor-kafka/operator.properties",
            "--topic",
            "editor.dead-letter.v1",
            capture_output=True,
            text=True,
        )
        .stdout.strip()
        .splitlines()
    )
    event = str(uuid.uuid4())
    marker = "INVALID_BILLING_PROBE_" + uuid.uuid4().hex
    raw = json.dumps({"unvalidated": marker})
    sql(
        "payment",
        "INSERT INTO saga_outbox(event_id,topic,aggregate_key,payload) VALUES("
        + ",".join(
            literal(value)
            for value in (event, "billing.identity.command.v1", user, raw)
        )
        + ");",
    )
    for _ in range(40):
        if (
            sql(
                "payment",
                f"SELECT COUNT(*) FROM saga_outbox WHERE event_id='{event}' AND published_at IS NOT NULL;",
            )
            == "1"
        ):
            break
        time.sleep(0.5)
    else:
        raise AssertionError("Invalid probe not delivered to broker")
    found = False
    for row in offsets:
        topic, partition, offset = row.split(":")
        result = probe(
            "exec",
            "-T",
            "kafka",
            "/opt/kafka/bin/kafka-console-consumer.sh",
            "--bootstrap-server",
            "localhost:9092",
            "--consumer.config",
            "/tmp/editor-kafka/operator.properties",
            "--topic",
            topic,
            "--partition",
            partition,
            "--offset",
            offset,
            "--max-messages",
            "1",
            "--timeout-ms",
            "5000",
            capture_output=True,
            text=True,
            check=False,
        )
        for line in result.stdout.splitlines():
            if not line.startswith("{"):
                continue
            entry = json.loads(line)
            payload = entry["payload"]
            if payload["originalTopic"] == "billing.identity.command.v1":
                assert (
                    payload["originalKey"] is None
                    and payload["originalPayloadBase64"] == ""
                )
                assert payload["reason"] == "INVALID_SCHEMA_REDACTED"
                found = True
    assert found, "No redacted billing DLQ record"
    assert (
        sql("identity", f"SELECT COUNT(*) FROM saga_inbox WHERE event_id='{event}';")
        == "0"
    )
    logs = compose(
        "logs", "--no-color", "identity-service", capture_output=True, text=True
    ).stdout
    assert marker not in logs, "Unvalidated probe leaked to logs"
    denied = probe(
        "exec",
        "-T",
        "kafka",
        "/opt/kafka/bin/kafka-console-consumer.sh",
        "--bootstrap-server",
        "localhost:9092",
        "--consumer.config",
        "/tmp/editor-kafka/identity.properties",
        "--topic",
        "billing.document.command.v1",
        "--partition",
        "0",
        "--offset",
        "0",
        "--max-messages",
        "1",
        "--timeout-ms",
        "3000",
        capture_output=True,
        text=True,
    )
    assert (
        not denied.stdout.strip() and "TopicAuthorization" in denied.stderr
    ), "Foreign billing topic read must be denied"
    note(
        "Invalid Kafka envelope produces redacted DLQ with no inbox/payload log; foreign participant topic access denied"
    )


def main():
    assert (
        call(requests.Session(), "GET", "/api/v1/billing/plans")["enabled"] is False
    ), "Stripe must be disabled for seeded local saga checks"
    session, user = account()
    call(requests.Session(), "GET", "/api/v1/billing/subscription", 401)
    call(session, "GET", "/api/v1/billing/requests/" + str(uuid.uuid4()), 404)
    call(
        session,
        "POST",
        "/api/v1/billing/checkout",
        503,
        headers={"Idempotency-Key": str(uuid.uuid4())},
        json={"plan": "PRO_MONTHLY"},
    )
    call(requests.Session(), "POST", "/api/v1/billing/webhooks/stripe", 503, data=b"{}")
    call(
        session,
        "POST",
        "/api/v1/billing/checkout",
        413,
        headers={
            "Idempotency-Key": str(uuid.uuid4()),
            "Content-Type": "application/json",
        },
        data=b" " * 9000,
    )
    note(
        "Private billing authorization, missing request ownership, disabled Stripe and body limit via real gateway"
    )
    upgraded = False
    try:
        compose("stop", "kafka", capture_output=True)
        try:
            saga, generation = seed(user, "PRO_MONTHLY")
            upgraded = True
            time.sleep(3)
            assert (
                sql(
                    "payment",
                    f"SELECT plan FROM payment_accounts WHERE user_id='{user}';",
                )
                == "FREE"
            )
            assert (
                sql(
                    "payment",
                    f"SELECT COUNT(*) FROM saga_outbox WHERE aggregate_key='{user}' AND published_at IS NULL;",
                )
                == "4"
            )
            note(
                "Broker outage preserves four SQL outbox intents and does not prematurely activate subscription"
            )
        finally:
            compose("start", "kafka", capture_output=True)
        wait_saga(user, saga)
        grants(user, "PRO_MONTHLY", generation)
        assert (
            call(session, "GET", "/api/v1/billing/subscription")["plan"]
            == "PRO_MONTHLY"
        )
        note(
            "Real SASL Kafka delivers all four commands/replies and activates only after complete saga"
        )
        counts = [
            sql(
                o,
                f"SELECT COUNT(*) FROM saga_inbox WHERE event_id IN (SELECT event_id FROM saga_inbox);",
            )
            for o in OWNERS
        ]
        sql(
            "payment",
            f"UPDATE saga_outbox SET published_at=NULL,next_attempt_at=CURRENT_TIMESTAMP(6),lease_until=NULL WHERE aggregate_key='{user}';",
        )
        time.sleep(8)
        grants(user, "PRO_MONTHLY", generation)
        assert counts == [sql(o, "SELECT COUNT(*) FROM saga_inbox;") for o in OWNERS]
        note(
            "Duplicate commands republish stable replies without duplicate business/inbox effects"
        )
        compose("restart", "payment-service", capture_output=True)
        wait_saga(user, saga)
        for _ in range(40):
            try:
                assert (
                    call(session, "GET", "/api/v1/billing/subscription")["plan"]
                    == "PRO_MONTHLY"
                )
                break
            except (requests.RequestException, AssertionError):
                time.sleep(1)
        else:
            raise AssertionError("Payment did not recover after restart")
        note("Payment service restart preserves completed subscription and saga")
        free_saga, free_generation = seed(user, "FREE")
        wait_saga(user, free_saga)
        grants(user, "FREE", free_generation)
        sql(
            "payment",
            "START TRANSACTION;"
            + insert_commands(user, saga, generation, "PRO_MONTHLY")
            + "COMMIT;",
        )
        time.sleep(8)
        grants(user, "FREE", free_generation)
        assert call(session, "GET", "/api/v1/billing/subscription")["plan"] == "FREE"
        upgraded = False
        note(
            "Higher-generation downgrade fences delayed old upgrade commands and replies"
        )
        invalid_delivery(user)
        phantom = str(uuid.uuid4())
        rejected, rejected_generation = seed(phantom, "PRO_MONTHLY")
        wait_saga(phantom, rejected, "MANUAL_REVIEW")
        grants(phantom, "FREE", rejected_generation + 1)
        note(
            "Absent Identity account triggers durable higher-generation compensation across all services"
        )
    finally:
        if upgraded:
            cleanup, _ = seed(user, "FREE")
            wait_saga(user, cleanup)
    report = ROOT / "testing/reports/billing-saga.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(
        json.dumps(
            {
                "status": "PASS",
                "checks": CHECKS,
                "stripeSandbox": "PENDING_CREDENTIALS",
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
