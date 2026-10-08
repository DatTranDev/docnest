"""Generate adversarial native style inputs outside the browser process (seed 42)."""

from pathlib import Path
import argparse, importlib.util, json, random

kit_root = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "native_input", kit_root / "testing/benchmark/native_input.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
parser = argparse.ArgumentParser()
parser.add_argument(
    "--output", type=Path, default=kit_root / "frontend/web/public/benchmarks"
)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
ledger = []
for count in [10000, 100000, 1000000]:
    rng = random.Random(42)
    n = 10485760
    length = n // count
    runs = []
    previous = -1
    for i in range(count):
        mask = rng.randrange(7)
        if mask >= previous >= 0:
            mask += 1
        previous = mask
        runs.append((n - length * i if i == count - 1 else length, mask))
    ledger.append(
        module.make(
            args.output / f"styles-{count}-10MiB.tedoc", "x" * n, "runs", runs=runs
        )
    )
    ledger[-1].pop("runs")
    ledger[-1]["logicalStyleRuns"] = count
(args.output / "style-index.json").write_text(
    json.dumps(ledger, indent=2) + "\n", encoding="utf-8"
)
print(
    json.dumps({"styleWorkloads": len(ledger), "seed": 42, "output": str(args.output)})
)
