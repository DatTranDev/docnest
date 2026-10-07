"""Run the real bounded Java validator against the kit's four generated workloads."""

from pathlib import Path
import ctypes
import datetime
import hashlib
import json
import os
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]


def memory(pid):
    if os.name == "nt":

        class Counters(ctypes.Structure):
            _fields_ = [
                ("cb", ctypes.c_ulong),
                ("PageFaultCount", ctypes.c_ulong),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        kernel = ctypes.windll.kernel32
        kernel.OpenProcess.restype = ctypes.c_void_p
        kernel.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
        kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        handle = kernel.OpenProcess(0x1000 | 0x10, False, pid)
        if not handle:
            return None
        counters = Counters()
        counters.cb = ctypes.sizeof(counters)
        get_memory = ctypes.windll.psapi.GetProcessMemoryInfo
        get_memory.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(Counters),
            ctypes.c_ulong,
        ]
        try:
            if get_memory(handle, ctypes.byref(counters), counters.cb):
                return int(counters.WorkingSetSize), int(counters.PeakWorkingSetSize)
        finally:
            kernel.CloseHandle(handle)
    elif Path(f"/proc/{pid}/status").exists():
        values = {}
        for line in Path(f"/proc/{pid}/status").read_text().splitlines():
            if line.startswith(("VmRSS:", "VmHWM:")):
                key, value = line.split(":", 1)
                values[key] = int(value.split()[0]) * 1024
        return values.get("VmRSS", 0), values.get("VmHWM", 0)
    return None


def main():
    env = os.environ.copy()
    bundled = sorted((ROOT / ".tools/jdk").glob("jdk-21*"))
    if bundled:
        env["JAVA_HOME"] = str(bundled[-1])
    wrapper = ROOT / ("mvnw.cmd" if os.name == "nt" else "mvnw")
    subprocess.run(
        [
            str(wrapper),
            "-B",
            "-ntp",
            "-pl",
            "backend/common",
            "-am",
            "-Pbenchmark",
            "-DskipTests",
            "test-compile",
        ],
        cwd=ROOT,
        env=env,
        check=True,
    )
    subprocess.run(
        [
            str(wrapper),
            "-B",
            "-ntp",
            "-pl",
            "backend/common",
            "dependency:build-classpath",
            "-Dmdep.outputFile=target/native-benchmark-classpath.txt",
        ],
        cwd=ROOT,
        env=env,
        check=True,
    )
    fixtures = ROOT / "testing/fixtures/large"
    if not (fixtures / "dense-10MiB.tedoc").exists():
        subprocess.run(
            [
                sys.executable,
                str(ROOT / "testing/fixtures/generate_fixtures.py"),
                "--large",
                "--output",
                str(fixtures),
            ],
            check=True,
        )
    classpath = os.pathsep.join(
        [
            str(ROOT / "backend/common/target/test-classes"),
            str(ROOT / "backend/common/target/classes"),
            (ROOT / "backend/common/target/native-benchmark-classpath.txt")
            .read_text()
            .strip(),
        ]
    )
    java = str(Path(env["JAVA_HOME"]) / "bin/java") if env.get("JAVA_HOME") else "java"
    target = ROOT / "testing/reports/native-benchmark.json"
    process = subprocess.Popen(
        [
            java,
            "-Xmx384m",
            "-XX:+UseSerialGC",
            "-cp",
            classpath,
            "vn.editor.benchmark.NativeBenchmark",
            str(fixtures),
            str(target),
        ],
        cwd=ROOT,
        env=env,
    )
    peak_rss = 0
    samples = 0
    while process.poll() is None:
        try:
            reading = memory(process.pid)
            if reading:
                peak_rss = max(peak_rss, reading[0], reading[1])
                samples += 1
        except (OSError, ProcessLookupError):
            pass
        time.sleep(0.025)
    if process.returncode:
        raise SystemExit(process.returncode)
    report = json.loads(target.read_text())
    report["measuredAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    report["sourceHashes"] = {
        str(path.relative_to(ROOT))
        .replace("\\", "/"): hashlib.sha256(path.read_bytes())
        .hexdigest()
        for path in [
            ROOT
            / "backend/common/src/main/java/vn/editor/common/codec/NativeCodec.java",
            ROOT
            / "backend/common/src/benchmark/java/vn/editor/benchmark/NativeBenchmark.java",
        ]
    }
    report["processMemory"] = {
        "source": (
            "Windows GetProcessMemoryInfo" if os.name == "nt" else "Linux /proc/status"
        ),
        "peakResidentBytes": peak_rss if samples else None,
        "samples": samples,
        "note": "Whole benchmark JVM RSS; not browser memory and no empty-app subtraction.",
    }
    target.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Wrote {target}")


if __name__ == "__main__":
    main()
