"""Generate native benchmark and smoke inputs with the Python standard library."""

from pathlib import Path
import argparse, hashlib, json, struct, zipfile


def uleb(n):
    out = bytearray()
    while True:
        b = n & 127
        n >>= 7
        out.append(b | (128 if n else 0))
        if not n:
            return bytes(out)


def encode_styles(n, kind="uniform", mask=0, runs=None):
    if n == 0:
        return b"TEDSTYLE" + struct.pack("<HHII", 1, 0, 0, 0)
    header = b"TEDSTYLE" + struct.pack("<HHII", 1, 0, n, 1)
    if kind == "uniform":
        return header + b"\x00" + uleb(n) + bytes([mask])
    if kind == "runs":
        assert sum(a for a, b in runs) == n
        return (
            header
            + b"\x01"
            + uleb(n)
            + uleb(len(runs))
            + b"".join(uleb(a) + bytes([b]) for a, b in runs)
        )
    if kind == "dense":
        out = bytearray(header + b"\x02" + uleb(n))
        for plane in range(3):
            for start in range(0, n, 32):
                word = 0
                for k in range(min(32, n - start)):
                    if ((start + k) % 8) & (1 << plane):
                        word |= 1 << k
                out.extend(struct.pack("<I", word))
        return bytes(out)
    raise ValueError(kind)


def make(path, text, kind="uniform", mask=0, runs=None):
    raw = text.encode("utf-8")
    n = len(text.encode("utf-16-le")) // 2
    styles = encode_styles(n, kind, mask, runs)
    manifest = {
        "schemaVersion": 1,
        "textEncoding": "utf-8",
        "internalEol": "LF",
        "preferredExportEol": "LF",
        "exportBom": False,
        "offsetUnit": "utf16",
        "utf8Bytes": len(raw),
        "utf16Length": n,
        "logicalLines": text.count("\n") + 1,
        "stylesEncoding": "adaptive-v1",
        "textSha256": hashlib.sha256(raw).hexdigest(),
        "stylesSha256": hashlib.sha256(styles).hexdigest(),
    }
    assert manifest["utf8Bytes"] <= 10485760 and manifest["logicalLines"] <= 1000000
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as z:
        for name, payload in [
            ("manifest.json", json.dumps(manifest, separators=(",", ":")).encode()),
            ("text.utf8", raw),
            ("styles.bin", styles),
        ]:
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_STORED
            z.writestr(info, payload)
    return {
        "file": path.name,
        "nativeBytes": path.stat().st_size,
        "nativeSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "manifest": manifest,
        "styleKind": kind,
        "runs": runs,
        "uniformMask": mask if kind == "uniform" else None,
    }


def generate(dest, large=False):
    ledger = []
    ledger.append(make(dest / "empty.tedoc", ""))
    ledger.append(
        make(
            dest / "unicode-uniform.tedoc", "A\U0001f600e\u0301\nVi\u1ec7t Nam", mask=1
        )
    )
    ledger.append(
        make(
            dest / "mixed-runs.tedoc",
            "hello world",
            "runs",
            runs=[(3, 1), (2, 3), (3, 2), (3, 0)],
        )
    )
    ledger.append(make(dest / "dense-ascii.tedoc", "ABCDEFGH" * 8, "dense"))
    if large:
        ledger.append(make(dest / "ascii-long-line-10MiB.tedoc", "x" * 10485760))
        ledger.append(make(dest / "million-lines.tedoc", "line12345\n" * 999999 + "x"))
        pattern = "Vi\u1ec7t Nam \U0001f600 e\u0301\n"
        raw = pattern.encode()
        text = pattern * (10485760 // len(raw))
        ledger.append(make(dest / "unicode-near-10MiB.tedoc", text))
        ledger.append(make(dest / "dense-10MiB.tedoc", "x" * 10485760, "dense"))
    (dest / "index.json").write_text(
        json.dumps(ledger, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return ledger


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--large", action="store_true")
    ap.add_argument("--output", type=Path)
    args = ap.parse_args()
    dest = args.output or Path(__file__).parent / "generated"
    ledger = generate(dest, args.large)
    print(
        json.dumps({"inputs": len(ledger), "directory": str(dest)}, ensure_ascii=False)
    )


if __name__ == "__main__":
    main()
