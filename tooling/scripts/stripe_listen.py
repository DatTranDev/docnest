#!/usr/bin/env python3
"""Configure ignored test credentials and forward local Stripe webhooks safely."""

import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import tomllib

ROOT = pathlib.Path(__file__).resolve().parents[2]
ENV = ROOT / ".env"
RUNTIME = ROOT / ".tools/stripe"
EVENTS = (
    "checkout.session.completed,checkout.session.async_payment_succeeded,"
    "checkout.session.async_payment_failed,customer.subscription.created,"
    "customer.subscription.updated,customer.subscription.deleted,invoice.paid,"
    "invoice.payment_failed,invoice.payment_action_required"
)
API_VERSION = "2026-09-30.endive"


def write_state(status, **values):
    (RUNTIME / "listener.json").write_text(
        json.dumps({"status": status, "pid": os.getpid(), **values}) + "\n",
        encoding="utf-8",
    )


def configure(key, secret):
    text = ENV.read_text(encoding="utf-8")
    for name, value in (
        ("STRIPE_SECRET_KEY", key),
        ("STRIPE_WEBHOOK_SECRET", secret),
    ):
        pattern = rf"^{name}=.*$"
        if re.search(pattern, text, re.MULTILINE):
            text = re.sub(pattern, f"{name}={value}", text, flags=re.MULTILINE)
        else:
            text = text.rstrip("\n") + f"\n{name}={value}\n"
    temporary = ENV.with_suffix(".stripe.tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as output:
        if os.name != "nt":
            os.chmod(temporary, 0o600)
        output.write(text)
    os.replace(temporary, ENV)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", default="default")
    args = parser.parse_args()
    RUNTIME.mkdir(parents=True, exist_ok=True)
    lock = RUNTIME / "listener.lock"
    try:
        with lock.open("x", encoding="utf-8") as output:
            output.write(str(os.getpid()))
    except FileExistsError:
        print("Listener lock exists. Check .tools/stripe/listener.json first.")
        return 1
    child = None
    try:
        config = subprocess.run(
            ["stripe", "--project-name", args.profile, "config", "--list"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
        )
        if config.returncode:
            raise RuntimeError("STRIPE_CLI_LOGIN_REQUIRED")
        key = (
            tomllib.loads(config.stdout)
            .get(args.profile, {})
            .get("test_mode_api_key", "")
        )
        if not re.fullmatch(r"sk_test_[A-Za-z0-9]+", key):
            raise RuntimeError("STRIPE_TEST_KEY_REQUIRED")
        text = ENV.read_text(encoding="utf-8")
        existing = re.search(r"^STRIPE_SECRET_KEY=(.*)$", text, re.MULTILINE)
        if existing and existing[1].strip().strip("\"'") not in ("", key):
            raise RuntimeError("EXISTING_STRIPE_KEY_DIFFERS_FROM_CLI_PROFILE")
        child = subprocess.Popen(
            [
                "stripe",
                "--project-name",
                args.profile,
                "listen",
                "--latest",
                "--skip-update",
                "--events",
                EVENTS,
                "--forward-to",
                "http://localhost:8080/api/v1/billing/webhooks/stripe",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        write_state("CONNECTING", stripePid=child.pid)
        configured = False
        for line in child.stdout:
            # Never relay CLI output: it contains signing secrets and event identifiers.
            secret = re.search(r"\bwhsec_[A-Za-z0-9]+\b", line)
            if secret and not configured:
                version = re.search(r"API Version \[([A-Za-z0-9.-]+)\]", line)
                api_version = version[1] if version else None
                if api_version != API_VERSION:
                    raise RuntimeError("STRIPE_LISTENER_API_VERSION_MISMATCH")
                configure(key, secret[0])
                rollout = subprocess.run(
                    [
                        "docker",
                        "compose",
                        "--env-file",
                        str(ENV),
                        "-f",
                        "infra/compose/compose.yaml",
                        "up",
                        "-d",
                        "--no-deps",
                        "--wait",
                        "--wait-timeout",
                        "120",
                        "payment-service",
                    ],
                    cwd=ROOT,
                    capture_output=True,
                    timeout=150,
                )
                if rollout.returncode:
                    raise RuntimeError("PAYMENT_RELOAD_FAILED")
                configured = True
                write_state(
                    "LISTENING",
                    stripePid=child.pid,
                    testKeyConfigured=True,
                    webhookSecretConfigured=True,
                    apiVersion=api_version,
                    apiVersionMatches=api_version == API_VERSION,
                )
                print(
                    "READY: test credentials configured; Payment healthy; listener active.",
                    flush=True,
                )
        raise RuntimeError("STRIPE_LISTENER_STOPPED")
    except KeyboardInterrupt:
        return 0
    except Exception as error:
        code = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print(f"Setup stopped: {code}", flush=True)
        return 1
    finally:
        if child and child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=10)
        write_state("STOPPED")
        lock.unlink(missing_ok=True)


if __name__ == "__main__":
    sys.exit(main())
