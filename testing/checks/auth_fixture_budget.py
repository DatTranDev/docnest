"""Pace isolated browser fixture logins without resetting/disabling the real limiter."""

import argparse
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tooling/scripts"))
from run import compose_prefix

SCRIPT = """
local delay=0
local count=0
for _,key in ipairs(redis.call('KEYS','rate:login:*')) do
  local value=tonumber(redis.call('GET',key) or '0')
  local ttl=redis.call('PTTL',key)
  if value+tonumber(ARGV[1])>10 then
    if value>0 and ttl<0 then return {-1,value} end
    delay=math.max(delay,ttl)
  end
  count=math.max(count,value)
end
return {delay,count}
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reserve", type=int, default=4)
    args = parser.parse_args()
    if not 1 <= args.reserve <= 10:
        raise ValueError("Fixture reservation exceeds the actual login window")
    if os.environ.get("GITHUB_ACTIONS") != "true" and not re.fullmatch(
        r"docsnest-(check|compat)-[a-f0-9]{12}",
        os.environ.get("EDITOR_COMPOSE_PROJECT", ""),
    ):
        raise ValueError(
            "Fixture pacing only runs on an owned test stack or ephemeral CI"
        )
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        result = subprocess.run(
            [
                *compose_prefix(),
                "exec",
                "-T",
                "redis",
                "redis-cli",
                "--raw",
                "EVAL_RO",
                SCRIPT,
                "0",
                str(args.reserve),
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode:
            raise ValueError("Read-only fixture login budget unavailable")
        try:
            delay, count = [int(value) for value in result.stdout.splitlines()]
        except ValueError:
            raise ValueError("Invalid read-only fixture login budget") from None
        if delay < 0:
            raise ValueError("Fixture login window has no expiry")
        if delay == 0:
            print("Fixture login budget available; production limiter unchanged")
            return
        time.sleep(min(delay / 1000 + 0.05, 5))
    raise ValueError("Fixture login window did not expire within its bound")


if __name__ == "__main__":
    main()
