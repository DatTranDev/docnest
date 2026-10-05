"""Executed replay validation against all authoritative envelopes; no fabricated broker evidence."""

import importlib.util, json, pathlib

root = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "replay", root / "scripts/replay_event.py"
)
replay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(replay)
checks = []
for topic in replay.TOPICS:
    raw = (root / f"contracts/events/{topic}.example.json").read_bytes()
    event, wire = replay.validate(topic, raw)
    assert json.loads(wire)["eventId"] == event["eventId"]
    checks.append(topic + " stable eventId/schema")
    for invalid in [
        raw.replace(b'"schemaVersion": 1', b'"schemaVersion": 999'),
        b'{"password":"private"}',
        b'{"a":1,"a":2}',
        b"x" * 65537,
    ]:
        try:
            replay.validate(topic, invalid)
        except (ValueError, UnicodeError):
            pass
        else:
            raise AssertionError("Invalid envelope accepted")
checks += [
    "schema/version, sensitive malformed envelope, duplicate keys and size caps rejected"
]
(root / "reports/replay-validation.json").write_text(
    json.dumps(
        {
            "status": "PASS",
            "checks": checks,
            "publish": "separate live replay evidence required",
        },
        indent=2,
    )
)
print("PASS replay validator: authoritative examples and invalid input rejection")
