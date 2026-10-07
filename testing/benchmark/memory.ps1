<#
.SYNOPSIS
Bounded Windows browser-tree memory sampler for a separate memory cohort.
.DESCRIPTION
Spawn this script with -NoProfile -NonInteractive and a hidden window. Wait for
ReadyPath JSON status READY (and samplerProcessId equal to the spawned PID), run
the separate serialization cohort, then create StopPath in a finally block and
await this process. Use fresh paths; a stale stop marker is rejected. Allow up to
10 seconds for PowerShell/C# startup. The sampler never stops the browser or any
other process; it independently exits at MaxDurationMs or browser exit.

Exit 0: stop marker or observed root exit; 3: bounded duration reached; 2: error.
Inspect JSON status, stopReason and incompleteSamples; exit 0 alone does not
establish a complete requested cohort. Working sets sum resident process pages
(shared pages can count in multiple processes), rather than private JS heap.
Sampled peak is a lower bound: spikes between polls and short-lived descendants
can be missed. Per-process lifetime peaks may predate the cohort and their sum
is not a simultaneous peak. PrivateUsage is committed private memory, not RAM.

Sources:
https://learn.microsoft.com/en-us/windows/win32/api/psapi/nf-psapi-getprocessmemoryinfo
https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-process_memory_counters_ex
https://learn.microsoft.com/en-us/windows/win32/api/tlhelp32/nf-tlhelp32-createtoolhelp32snapshot
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$BrowserProcessId,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [Parameter(Mandatory = $true)][string]$StopPath,
    [string]$ReadyPath,
    [ValidateRange(10, 1000)][int]$IntervalMs = 50,
    [ValidateRange(100, 600000)][int]$MaxDurationMs = 30000
)

$ErrorActionPreference = 'Stop'
$taskOutput = [IO.Path]::GetFullPath($OutputPath)
$taskStop = [IO.Path]::GetFullPath($StopPath)
if (-not $ReadyPath) { $ReadyPath = "$taskOutput.ready.json" }
$taskReady = [IO.Path]::GetFullPath($ReadyPath)
$taskStarted = [DateTime]::UtcNow.ToString('o')
$taskSamples = [Collections.Generic.List[object]]::new()
$taskKnownProcesses = @{}
$taskRootCreation = $null
$taskReadyWritten = $false
$taskExitCode = 0
$taskStatus = 'COMPLETED'
$taskStopReason = $null
$taskFailure = $null
$taskClock = [Diagnostics.Stopwatch]::new()

function Write-TaskJson([string]$TaskPath, [object]$TaskValue) {
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($TaskPath))
    $taskTemporary = "$TaskPath.$PID.tmp"
    [IO.File]::WriteAllText($taskTemporary, (ConvertTo-Json -InputObject $TaskValue -Depth 12), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $taskTemporary -Destination $TaskPath -Force
}

try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw 'This sampler uses native Windows process APIs; it cannot measure other operating systems.'
    }
    if ($taskOutput -eq $taskStop -or $taskReady -eq $taskStop -or $taskOutput -eq $taskReady) {
        throw 'Output, readiness and stop-marker paths must be distinct.'
    }
    if ([IO.File]::Exists($taskStop)) { throw 'Stop marker already exists; use fresh cohort paths.' }

    # Toolhelp process enumeration avoids a slow WMI/CIM round trip per 50 ms poll.
    # Query-limited-information handles suffice for modern Windows memory APIs.
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
namespace TedocBenchmark {
    public sealed class ProcessReading {
        public int ProcessId;
        public int ParentProcessId;
        public string Name;
        public ulong CreationTimeFileTime;
        public ulong WorkingSetBytes;
        public ulong LifetimePeakWorkingSetBytes;
        public ulong PrivateCommitBytes;
        public int ErrorCode;
        public string ErrorStage;
    }
    public sealed class TreeReading {
        public bool RootPresent;
        public ProcessReading[] Processes;
    }
    public static class MemoryNative {
        [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
        private struct Entry {
            public uint Size, Usage, ProcessId;
            public UIntPtr DefaultHeapId;
            public uint ModuleId, Threads, ParentId;
            public int Priority;
            public uint Flags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string Name;
        }
        [StructLayout(LayoutKind.Sequential)]
        private struct Counters {
            public uint Size, PageFaultCount;
            public UIntPtr PeakWorkingSet, WorkingSet, PeakPagedPool, PagedPool;
            public UIntPtr PeakNonPagedPool, NonPagedPool, PagefileUsage, PeakPagefileUsage, PrivateUsage;
        }
        [StructLayout(LayoutKind.Sequential)]
        private struct FileTime { public uint Low, High; }
        [DllImport("kernel32.dll", SetLastError=true)]
        private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        private static extern bool Process32FirstW(IntPtr snapshot, ref Entry entry);
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        private static extern bool Process32NextW(IntPtr snapshot, ref Entry entry);
        [DllImport("kernel32.dll", SetLastError=true)]
        private static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
        [DllImport("kernel32.dll", SetLastError=true)]
        private static extern bool GetProcessTimes(IntPtr process, out FileTime creation, out FileTime exit, out FileTime kernel, out FileTime user);
        [DllImport("psapi.dll", SetLastError=true)]
        private static extern bool GetProcessMemoryInfo(IntPtr process, ref Counters counters, uint size);
        [DllImport("kernel32.dll")]
        private static extern bool CloseHandle(IntPtr handle);

        public static TreeReading Capture(int rootId) {
            var entries = new Dictionary<int, Entry>();
            IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
            if (snapshot == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
            try {
                var entry = new Entry { Size = (uint)Marshal.SizeOf(typeof(Entry)) };
                if (!Process32FirstW(snapshot, ref entry)) throw new Win32Exception(Marshal.GetLastWin32Error());
                do { entries[(int)entry.ProcessId] = entry; } while (Process32NextW(snapshot, ref entry));
                int ending = Marshal.GetLastWin32Error();
                if (ending != 18) throw new Win32Exception(ending); // ERROR_NO_MORE_FILES
            } finally { CloseHandle(snapshot); }
            if (!entries.ContainsKey(rootId)) return new TreeReading { RootPresent = false, Processes = new ProcessReading[0] };
            var selected = new HashSet<int>();
            selected.Add(rootId);
            bool changed;
            do {
                changed = false;
                foreach (var pair in entries) {
                    if (selected.Contains((int)pair.Value.ParentId) && selected.Add(pair.Key)) changed = true;
                }
            } while (changed);
            var readings = new List<ProcessReading>();
            foreach (int id in selected) {
                Entry entry = entries[id];
                var reading = new ProcessReading { ProcessId = id, ParentProcessId = (int)entry.ParentId, Name = entry.Name };
                IntPtr handle = OpenProcess(0x1000, false, (uint)id); // PROCESS_QUERY_LIMITED_INFORMATION
                if (handle == IntPtr.Zero) {
                    reading.ErrorCode = Marshal.GetLastWin32Error(); reading.ErrorStage = "OpenProcess";
                } else {
                    try {
                        FileTime creation, exit, kernel, user;
                        if (!GetProcessTimes(handle, out creation, out exit, out kernel, out user)) {
                            reading.ErrorCode = Marshal.GetLastWin32Error(); reading.ErrorStage = "GetProcessTimes";
                        } else {
                            reading.CreationTimeFileTime = ((ulong)creation.High << 32) | creation.Low;
                            var counters = new Counters { Size = (uint)Marshal.SizeOf(typeof(Counters)) };
                            if (!GetProcessMemoryInfo(handle, ref counters, counters.Size)) {
                                reading.ErrorCode = Marshal.GetLastWin32Error(); reading.ErrorStage = "GetProcessMemoryInfo";
                            } else {
                                reading.WorkingSetBytes = counters.WorkingSet.ToUInt64();
                                reading.LifetimePeakWorkingSetBytes = counters.PeakWorkingSet.ToUInt64();
                                reading.PrivateCommitBytes = counters.PrivateUsage.ToUInt64();
                            }
                        }
                    } finally { CloseHandle(handle); }
                }
                readings.Add(reading);
            }
            readings.Sort((left, right) => left.ProcessId.CompareTo(right.ProcessId));
            return new TreeReading { RootPresent = true, Processes = readings.ToArray() };
        }
    }
}
'@
    $taskClock.Start()
    $taskNextAt = 0.0
    while ($true) {
        if ([IO.File]::Exists($taskStop)) { $taskStopReason = 'STOP_FILE'; break }
        if ($taskClock.Elapsed.TotalMilliseconds -ge $MaxDurationMs) {
            $taskStopReason = 'DURATION_LIMIT'; $taskStatus = 'TIMED_OUT'; $taskExitCode = 3; break
        }
        $taskAt = $taskClock.Elapsed.TotalMilliseconds
        $taskTree = [TedocBenchmark.MemoryNative]::Capture($BrowserProcessId)
        if (-not $taskTree.RootPresent) {
            if ($taskSamples.Count -eq 0) { throw 'Root process was absent before the memory cohort; no memory sample captured.' }
            $taskStopReason = 'ROOT_EXITED'; break
        }
        $taskRoot = @($taskTree.Processes | Where-Object { $_.ProcessId -eq $BrowserProcessId })[0]
        if ($taskRoot.ErrorCode -ne 0) { throw "Root process query failed at $($taskRoot.ErrorStage): Win32 error $($taskRoot.ErrorCode)." }
        $taskCreation = $taskRoot.CreationTimeFileTime.ToString()
        if (-not $taskRootCreation) { $taskRootCreation = $taskCreation }
        elseif ($taskRootCreation -ne $taskCreation) { $taskStopReason = 'ROOT_PID_REUSED'; $taskStatus = 'BLOCKED'; $taskExitCode = 2; break }
        $taskProcessSamples = [Collections.Generic.List[object]]::new()
        $taskErrors = [Collections.Generic.List[object]]::new()
        $taskWorkingSet = 0L; $taskPrivateCommit = 0L; $taskLifetimePeaks = 0L
        foreach ($taskProcess in $taskTree.Processes) {
            if ($taskProcess.ErrorCode -ne 0) {
                $taskErrors.Add([ordered]@{ processId = $taskProcess.ProcessId; stage = $taskProcess.ErrorStage; win32Error = $taskProcess.ErrorCode })
            } else {
                # Exclude stale-parent PID references to processes older than this root.
                if ($taskProcess.CreationTimeFileTime -lt $taskRoot.CreationTimeFileTime) { continue }
                $taskWorkingSet += [long]$taskProcess.WorkingSetBytes
                $taskPrivateCommit += [long]$taskProcess.PrivateCommitBytes
                $taskLifetimePeaks += [long]$taskProcess.LifetimePeakWorkingSetBytes
            }
            $taskIdentity = "$($taskProcess.ProcessId):$($taskProcess.CreationTimeFileTime)"
            $taskProcessRecord = [ordered]@{
                processId = $taskProcess.ProcessId; parentProcessId = $taskProcess.ParentProcessId; name = $taskProcess.Name
                creationTimeFileTime = $taskProcess.CreationTimeFileTime.ToString()
                workingSetBytes = [long]$taskProcess.WorkingSetBytes
                lifetimePeakWorkingSetBytes = [long]$taskProcess.LifetimePeakWorkingSetBytes
                privateCommitBytes = [long]$taskProcess.PrivateCommitBytes
                queryComplete = ($taskProcess.ErrorCode -eq 0)
            }
            $taskProcessSamples.Add($taskProcessRecord)
            if (-not $taskKnownProcesses.ContainsKey($taskIdentity)) {
                $taskKnownProcesses[$taskIdentity] = [ordered]@{
                    processId = $taskProcess.ProcessId; parentProcessId = $taskProcess.ParentProcessId
                    name = $taskProcess.Name; creationTimeFileTime = $taskProcess.CreationTimeFileTime.ToString()
                    firstSeenMs = $taskAt; lastSeenMs = $taskAt
                    maxObservedWorkingSetBytes = [long]$taskProcess.WorkingSetBytes
                    maxLifetimePeakWorkingSetBytes = [long]$taskProcess.LifetimePeakWorkingSetBytes
                }
            } else {
                $taskKnownProcesses[$taskIdentity].lastSeenMs = $taskAt
                $taskKnownProcesses[$taskIdentity].maxObservedWorkingSetBytes = [Math]::Max($taskKnownProcesses[$taskIdentity].maxObservedWorkingSetBytes, [long]$taskProcess.WorkingSetBytes)
                $taskKnownProcesses[$taskIdentity].maxLifetimePeakWorkingSetBytes = [Math]::Max($taskKnownProcesses[$taskIdentity].maxLifetimePeakWorkingSetBytes, [long]$taskProcess.LifetimePeakWorkingSetBytes)
            }
        }
        $taskSamples.Add([ordered]@{
            elapsedMs = $taskAt; captureDurationMs = ($taskClock.Elapsed.TotalMilliseconds - $taskAt)
            workingSetBytes = $taskWorkingSet; privateCommitBytes = $taskPrivateCommit
            summedLifetimePeakWorkingSetBytes = $taskLifetimePeaks; complete = ($taskErrors.Count -eq 0)
            processes = @($taskProcessSamples.ToArray()); errors = @($taskErrors.ToArray())
        })
        if (-not $taskReadyWritten) {
            Write-TaskJson $taskReady ([ordered]@{
                status = 'READY'; samplerProcessId = $PID; rootProcessId = $BrowserProcessId
                rootCreationTimeFileTime = $taskRootCreation; readyAtUtc = [DateTime]::UtcNow.ToString('o')
                intervalMs = $IntervalMs; maxDurationMs = $MaxDurationMs; outputPath = $taskOutput
            })
            $taskReadyWritten = $true
        }
        $taskNextAt += $IntervalMs
        $taskNow = $taskClock.Elapsed.TotalMilliseconds
        # Do not make back-to-back catch-up samples after a slow snapshot.
        if ($taskNextAt -le $taskNow) { $taskNextAt = $taskNow + $IntervalMs }
        [Threading.Thread]::Sleep([int][Math]::Ceiling($taskNextAt - $taskNow))
    }
} catch {
    $taskFailure = $_.Exception.Message
    $taskStatus = 'BLOCKED'; $taskStopReason = 'ERROR'; $taskExitCode = 2
    if (-not $taskReadyWritten) {
        Write-TaskJson $taskReady ([ordered]@{ status = 'ERROR'; samplerProcessId = $PID; rootProcessId = $BrowserProcessId; error = $taskFailure })
    }
} finally {
    $taskClock.Stop()
    $taskGaps = [Collections.Generic.List[double]]::new()
    for ($taskIndex = 1; $taskIndex -lt $taskSamples.Count; $taskIndex++) {
        $taskGaps.Add($taskSamples[$taskIndex].elapsedMs - $taskSamples[$taskIndex - 1].elapsedMs)
    }
    $taskSortedGaps = @($taskGaps.ToArray() | Sort-Object)
    $taskGapStats = $null
    if ($taskSortedGaps.Count -gt 0) {
        $taskGapStats = [ordered]@{
            min = $taskSortedGaps[0]; p50 = $taskSortedGaps[[Math]::Max(0, [int][Math]::Ceiling($taskSortedGaps.Count * 0.5) - 1)]
            p95 = $taskSortedGaps[[Math]::Max(0, [int][Math]::Ceiling($taskSortedGaps.Count * 0.95) - 1)]
            max = $taskSortedGaps[-1]
        }
    }
    $taskComplete = @($taskSamples.ToArray() | Where-Object { $_.complete })
    $taskReport = [ordered]@{
        status = $taskStatus; stopReason = $taskStopReason; error = $taskFailure
        rootProcessId = $BrowserProcessId; rootCreationTimeFileTime = $taskRootCreation; samplerProcessId = $PID
        startedAtUtc = $taskStarted; endedAtUtc = [DateTime]::UtcNow.ToString('o'); durationMs = $taskClock.Elapsed.TotalMilliseconds
        intervalMsRequested = $IntervalMs; maxDurationMs = $MaxDurationMs; observedGapsMs = $taskGapStats
        method = 'Windows Toolhelp PID/parent-PID descendant snapshot + GetProcessMemoryInfo working sets; independent cohort, no WMI or heap substitute.'
        measurementIsLowerBound = $true
        limitations = @('Sampled spikes shorter than a poll and descendants born/exited between polls can be missed.', 'Process counters are sequential within a snapshot and are not atomically simultaneous.', 'Resident shared pages may count in multiple working sets.', 'Lifetime process peaks may predate this cohort and their sum is not a simultaneous peak.', 'Private commit is not physical RAM.', 'Orphan descendants whose parent has exited may leave the currently rooted tree; prior observations remain in processHistory.')
        sampleCount = $taskSamples.Count; completeSamples = $taskComplete.Count; incompleteSamples = ($taskSamples.Count - $taskComplete.Count)
        peakObservedWorkingSetBytes = ($taskSamples.ToArray() | ForEach-Object { $_.workingSetBytes } | Measure-Object -Maximum).Maximum
        peakCompleteSampleWorkingSetBytes = ($taskComplete | ForEach-Object { $_.workingSetBytes } | Measure-Object -Maximum).Maximum
        peakObservedPrivateCommitBytes = ($taskSamples.ToArray() | ForEach-Object { $_.privateCommitBytes } | Measure-Object -Maximum).Maximum
        maxSummedLifetimePeakWorkingSetBytes = ($taskSamples.ToArray() | ForEach-Object { $_.summedLifetimePeakWorkingSetBytes } | Measure-Object -Maximum).Maximum
        processHistory = @($taskKnownProcesses.Values | Sort-Object processId, creationTimeFileTime)
        samples = @($taskSamples.ToArray())
    }
    Write-TaskJson $taskOutput $taskReport
    Write-Output (ConvertTo-Json -InputObject ([ordered]@{ status = $taskStatus; stopReason = $taskStopReason; sampleCount = $taskSamples.Count; outputPath = $taskOutput }) -Compress)
}
exit $taskExitCode
