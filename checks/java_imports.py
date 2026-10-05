"""Fail on wildcard Java imports in handwritten service/check sources."""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
errors = []
paths = list((ROOT / "services").rglob("*.java")) + list(
    (ROOT / "checks/java").glob("*.java")
)
for path in paths:
    if "target" in path.parts:
        continue
    for match in re.finditer(
        r"\bimport\s+(?:static\s+)?[\w.]+\.\*\s*;", path.read_text(encoding="utf-8")
    ):
        errors.append(f"{path.relative_to(ROOT)}: {match.group(0)}")
if errors:
    print("\n".join(errors))
    sys.exit(1)
print("PASS explicit imports in handwritten Java source and tests")
