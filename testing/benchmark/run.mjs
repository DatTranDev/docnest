import { chromium } from '@playwright/test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {
  appRoot,
  repositoryRoot,
  editorSourceFiles,
  productionServer,
  sourceHashes as hashSources,
} from './production.mjs';

const allWorkloads = [
  'ascii-long-line-10MiB.tedoc',
  'million-lines.tedoc',
  'unicode-near-10MiB.tedoc',
  'dense-10MiB.tedoc',
  'styles-10000-10MiB.tedoc',
  'styles-100000-10MiB.tedoc',
  'styles-1000000-10MiB.tedoc',
];
const workloads = process.env.BENCH_WORKLOADS
  ? process.env.BENCH_WORKLOADS.split(',')
      .map((file) => file.trim())
      .filter(Boolean)
  : allWorkloads;
if (
  !workloads.length ||
  new Set(workloads).size !== workloads.length ||
  workloads.some((file) => !allWorkloads.includes(file))
)
  throw new Error(
    'BENCH_WORKLOADS must be a comma-separated selection of distinct supported workload filenames.',
  );
const quick = process.env.BENCH_QUICK === '1';
const memoryIsolation = process.env.BENCH_MEMORY_ISOLATION ?? 'reuse';
if (!['reuse', 'per-workload'].includes(memoryIsolation))
  throw new Error('BENCH_MEMORY_ISOLATION must be reuse or per-workload.');
const samples = quick ? 3 : 30,
  inputSamples = quick ? 20 : 1000,
  warmup = quick ? 1 : 5;
const reportPath = path.resolve(
  repositoryRoot,
  process.env.BENCH_REPORT_FILE ?? 'testing/reports/browser-benchmark.json',
);
const baselinePath = path.resolve(
  repositoryRoot,
  process.env.BENCH_BASELINE_FILE ?? 'testing/benchmark/baseline/browser-benchmark.json',
);
const sources = [
  ...editorSourceFiles,
  'frontend/web/src/features/editor/benchmark/browser.ts',
  'frontend/web/src/features/editor/components/BenchmarkHarness.tsx',
  'frontend/web/src/app/globals.css',
];
const sourceHashes = await hashSources(sources);
const instrumentationFiles = [
  'testing/benchmark/run.mjs',
  'testing/benchmark/production.mjs',
  'testing/benchmark/memory.ps1',
  'testing/benchmark/generate.py',
];
const instrumentationSourceHashes = await hashSources(instrumentationFiles);
let sourceHashesAfter = null,
  instrumentationSourceHashesAfter = null,
  ownedServer = null,
  server = null,
  browser = null,
  page = null,
  browserPid = null,
  baselineRss = null,
  baseline = null,
  browserVersion = null,
  failure = null;
const results = [];
const fixtureReferences = new Map();
const browserOptions = {
  headless: true,
  args: [
    '--enable-precise-memory-info',
    '--js-flags=--expose-gc',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
  ],
};
async function memoryStage(targetPage = page, targetPid = browserPid, operation = null) {
  const exercise = async () => {
    if (operation) return operation();
    for (let i = 0; i < 3; i++) await targetPage.evaluate(() => window.bench.serialize());
  };
  if (process.platform !== 'win32') {
    await exercise();
    return null;
  }
  const prefix = path.join(repositoryRoot, '.tools', 'browser-memory-' + randomUUID()),
    output = prefix + '.json',
    stop = prefix + '.stop',
    ready = prefix + '.ready';
  await mkdir(path.dirname(prefix), { recursive: true });
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      path.join(repositoryRoot, 'testing/benchmark/memory.ps1'),
      '-BrowserProcessId',
      String(targetPid),
      '-OutputPath',
      output,
      '-StopPath',
      stop,
      '-ReadyPath',
      ready,
      '-IntervalMs',
      '50',
      '-MaxDurationMs',
      '30000',
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stderr.on('data', (c) => (stderr += c));
  const completion = new Promise((resolve) => {
    child.on('error', (e) => resolve({ code: null, error: String(e) }));
    child.on('close', (code) => resolve({ code, error: stderr }));
  });
  let failure;
  try {
    const deadline = Date.now() + 10000;
    while (true) {
      try {
        const value = JSON.parse(await readFile(ready, 'utf8'));
        if (value.status === 'READY' && value.samplerProcessId === child.pid) break;
      } catch {}
      if (Date.now() > deadline) throw new Error('Memory sampler did not become ready');
      await new Promise((r) => setTimeout(r, 50));
    }
    await exercise();
  } catch (error) {
    failure = error;
  } finally {
    await writeFile(stop, 'stop');
  }
  const finished = await completion;
  if (failure) throw failure;
  if (finished.code !== 0) throw new Error('Memory sampler failed: ' + finished.error);
  const result = JSON.parse(await readFile(output, 'utf8'));
  if (result.sampleCount < 2 || result.incompleteSamples > 0)
    throw new Error('Memory cohort did not produce complete repeated process-tree samples');
  for (const file of [output, stop, ready]) await rm(file, { force: true });
  return result;
}
async function geometryFor(targetPage) {
  const geometry = await targetPage.evaluate(() => {
    const host = document.getElementById('editor').getBoundingClientRect();
    return {
      width: host.width,
      height: host.height,
      lineHeight: getComputedStyle(document.querySelector('.cm-line')).lineHeight,
    };
  });
  if (geometry.width !== 1400 || geometry.height !== 2000 || geometry.lineHeight !== '20px')
    throw new Error(`Benchmark geometry changed from the baseline: ${JSON.stringify(geometry)}`);
  return geometry;
}
async function isolatedMemory(file, reference, timingMetrics) {
  let memoryServer = null,
    memoryBrowser = null;
  try {
    memoryServer = await chromium.launchServer(browserOptions);
    const processId = memoryServer.process().pid;
    if (processId === browserPid)
      throw new Error('Memory isolation reused the timing browser PID.');
    memoryBrowser = await chromium.connect(memoryServer.wsEndpoint());
    if (memoryBrowser.version() !== browserVersion)
      throw new Error('Timing and memory browsers have different versions.');
    const memoryPage = await memoryBrowser.newPage({ viewport: { width: 1500, height: 2100 } });
    await memoryPage.goto(`${ownedServer.baseUrl}/benchmark`);
    await memoryPage.waitForFunction(() => !!window.bench);
    await memoryPage.evaluate(() => window.bench.empty());
    const geometry = await geometryFor(memoryPage),
      emptyMetrics = await memoryPage.evaluate(() => window.bench.metrics());
    if (emptyMetrics.utf8Bytes || emptyMetrics.utf16Length || emptyMetrics.historyBytes)
      throw new Error('Fresh memory baseline is not an empty editor.');
    // Native process-tree sampling precedes any fixture loading or conditioning.
    const baselineSampling = await memoryStage(memoryPage, processId, async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    const memoryBaselineRss = baselineSampling?.samples.at(-1).workingSetBytes ?? null;
    const preparedBytes = await memoryPage.evaluate((name) => window.bench.prepare(name), file);
    if (preparedBytes !== reference.nativeBytes)
      throw new Error(`Fresh memory browser prepared the wrong native size for ${file}.`);
    let uiText;
    for (let i = 0; i < warmup; i++) {
      await memoryPage.evaluate(() => window.bench.open());
      if (i === 0) {
        uiText = await memoryPage.evaluate(async () => {
          const text = await window.bench.copyText(),
            encoded = new TextEncoder().encode(text),
            hash = await crypto.subtle.digest('SHA-256', encoded);
          let logicalLines = 1;
          for (let at = 0; at < text.length; at++) if (text.charCodeAt(at) === 10) logicalLines++;
          return {
            sha256: Array.from(new Uint8Array(hash), (byte) =>
              byte.toString(16).padStart(2, '0'),
            ).join(''),
            utf8Bytes: encoded.length,
            utf16Length: text.length,
            logicalLines,
          };
        });
        if (
          uiText.sha256 !== reference.manifest.textSha256 ||
          uiText.utf8Bytes !== reference.manifest.utf8Bytes ||
          uiText.utf16Length !== reference.manifest.utf16Length ||
          uiText.logicalLines !== reference.manifest.logicalLines
        )
          throw new Error(`Fresh memory UI text differs from the fixture manifest for ${file}.`);
      }
    }
    // Replay the complete workload so retained history, cache and required native buffers match
    // the timing cohort. Only the preceding workloads' allocator/process state is isolated.
    for (let i = 0; i < samples; i++) {
      await memoryPage.evaluate(() => window.bench.open());
      await memoryPage.evaluate(() => window.bench.gc());
    }
    for (let i = 0; i < inputSamples; i++)
      await memoryPage.evaluate((index) => window.bench.input(index), i);
    for (let i = 0; i < samples; i++) {
      await memoryPage.evaluate((index) => window.bench.scroll(index), i);
      await memoryPage.evaluate(() => window.bench.search());
      await memoryPage.evaluate(() => window.bench.serialize());
      await memoryPage.evaluate((index) => window.bench.undoRedo(index), i);
    }
    await memoryPage.evaluate(() => window.bench.gc());
    const metrics = await memoryPage.evaluate(() => window.bench.metrics());
    const comparableDimensions = [
      'utf8Bytes',
      'utf16Length',
      'lines',
      'runs',
      'domLines',
      'domStyleSpans',
      'historyBytes',
      'styleNodes',
    ];
    for (const dimension of comparableDimensions)
      if (metrics[dimension] !== timingMetrics[dimension])
        throw new Error(`Fresh memory conditioning differs for ${file}: ${dimension}.`);
    const sampling = await memoryStage(memoryPage, processId),
      steadyRss = sampling?.samples[0].workingSetBytes ?? null,
      peakObservedRss = sampling?.peakObservedWorkingSetBytes ?? null;
    return {
      strategy: memoryIsolation,
      browserProcessId: processId,
      browserVersion: memoryBrowser.version(),
      geometry,
      baseline: { metrics: emptyMetrics, sampling: baselineSampling },
      baselineRss: memoryBaselineRss,
      baselineRssMethod:
        'Last complete native process-tree sample of an empty app before fixture loading.',
      steadyRss,
      steadyRssMethod: 'First complete native process-tree sample before the three serializations.',
      peakObservedRss,
      sampling,
      metrics,
      fixture: { preparedBytes, uiText },
      conditioning: {
        warmup,
        openSamples: samples,
        inputSamples,
        scrollSearchSerializeUndoSamples: samples,
        matchesTimingDimensions: comparableDimensions,
        requiredLiveBuffersRetained: true,
      },
      timingBrowserProcessId: browserPid,
      timingBrowserRetainedDuringMemoryCohort: true,
      steadyDeltaMiB:
        steadyRss && memoryBaselineRss ? (steadyRss - memoryBaselineRss) / 1048576 : null,
      peakObservedDeltaMiB:
        peakObservedRss && memoryBaselineRss
          ? (peakObservedRss - memoryBaselineRss) / 1048576
          : null,
    };
  } finally {
    try {
      await memoryBrowser?.close();
    } finally {
      await memoryServer?.close();
    }
  }
}
function rss() {
  if (process.platform === 'win32') {
    const script = `$taskRoot=${browserPid}; $taskProcesses=Get-CimInstance Win32_Process; $taskIds=[System.Collections.Generic.HashSet[int]]::new(); [void]$taskIds.Add($taskRoot); do {$taskChanged=$false; foreach($taskProcess in $taskProcesses) {if($taskIds.Contains([int]$taskProcess.ParentProcessId) -and $taskIds.Add([int]$taskProcess.ProcessId)) {$taskChanged=$true}}}while($taskChanged); $taskSum=0L; foreach($taskId in $taskIds) {$taskP=Get-Process -Id $taskId -ErrorAction SilentlyContinue; if($taskP){$taskSum+=$taskP.WorkingSet64}}; Write-Output $taskSum`;
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
    });
    return Number(r.stdout.trim()) || null;
  }
  return null;
}
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b),
    q = (p) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
  return { samples: values.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: sorted.at(-1) };
};

try {
  for (const args of [
    [
      path.join(repositoryRoot, 'testing/fixtures/generate_fixtures.py'),
      '--large',
      '--output',
      path.join(appRoot, 'public/benchmarks'),
    ],
    [path.join(repositoryRoot, 'testing/benchmark/generate.py')],
  ]) {
    const generated = spawnSync(process.env.PYTHON ?? 'python', args, {
      cwd: appRoot,
      stdio: 'inherit',
    });
    if (generated.status !== 0)
      throw new Error(
        `Benchmark fixture generation failed (${generated.status}): ${generated.error ?? ''}`,
      );
  }
  for (const ledger of ['index.json', 'style-index.json']) {
    const entries = JSON.parse(
      await readFile(path.join(appRoot, 'public/benchmarks', ledger), 'utf8'),
    );
    for (const entry of entries) fixtureReferences.set(entry.file, entry);
  }
  ownedServer = await productionServer({ port: 5174, externalBaseUrl: process.env.BENCH_BASE_URL });
  server = await chromium.launchServer(browserOptions);
  browser = await chromium.connect(server.wsEndpoint());
  browserVersion = browser.version();
  page = await browser.newPage({ viewport: { width: 1500, height: 2100 } });
  await page.goto(`${ownedServer.baseUrl}/benchmark`);
  await page.waitForFunction(() => !!window.bench);
  await page.evaluate(() => window.bench.empty());
  const geometry = await page.evaluate(() => {
    const host = document.getElementById('editor').getBoundingClientRect();
    return {
      width: host.width,
      height: host.height,
      lineHeight: getComputedStyle(document.querySelector('.cm-line')).lineHeight,
    };
  });
  if (geometry.width !== 1400 || geometry.height !== 2000 || geometry.lineHeight !== '20px')
    throw new Error(`Benchmark geometry changed from the baseline: ${JSON.stringify(geometry)}`);
  browserPid = server.process().pid;
  baselineRss = rss();
  baseline = await page.evaluate(() => window.bench.metrics());
  for (const file of workloads) {
    console.log(`Benchmark ${file}`);
    const reference = fixtureReferences.get(file);
    if (!reference) throw new Error(`Fixture ledger entry missing for ${file}.`);
    const generatedSha256 = createHash('sha256')
      .update(await readFile(path.join(appRoot, 'public/benchmarks', file)))
      .digest('hex');
    const servedResponse = await fetch(`${ownedServer.baseUrl}/benchmarks/${file}`, {
      cache: 'no-store',
    });
    if (!servedResponse.ok)
      throw new Error(`Fixture server returned ${servedResponse.status} for ${file}.`);
    const servedSha256 = createHash('sha256')
      .update(new Uint8Array(await servedResponse.arrayBuffer()))
      .digest('hex');
    const browserPreparedNativeBytes = await page.evaluate(
      (file) => window.bench.prepare(file),
      file,
    );
    if (
      generatedSha256 !== reference.nativeSha256 ||
      servedSha256 !== generatedSha256 ||
      browserPreparedNativeBytes !== reference.nativeBytes
    )
      throw new Error(
        `Generated/served/browser fixture identity does not match the native ledger for ${file}.`,
      );
    let uiText = null;
    for (let i = 0; i < warmup; i++) {
      await page.evaluate(() => window.bench.open());
      if (i === 0) {
        uiText = await page.evaluate(async () => {
          const text = await window.bench.copyText(),
            encoded = new TextEncoder().encode(text);
          const hash = await crypto.subtle.digest('SHA-256', encoded);
          let logicalLines = 1;
          for (let at = 0; at < text.length; at++) if (text.charCodeAt(at) === 10) logicalLines++;
          return {
            sha256: Array.from(new Uint8Array(hash), (byte) =>
              byte.toString(16).padStart(2, '0'),
            ).join(''),
            utf8Bytes: encoded.length,
            utf16Length: text.length,
            logicalLines,
          };
        });
        if (
          uiText.sha256 !== reference.manifest.textSha256 ||
          uiText.utf8Bytes !== reference.manifest.utf8Bytes ||
          uiText.utf16Length !== reference.manifest.utf16Length ||
          uiText.logicalLines !== reference.manifest.logicalLines
        )
          throw new Error(`UI text does not match the native fixture manifest for ${file}.`);
      }
    }
    const open = [];
    for (let i = 0; i < samples; i++) {
      open.push(await page.evaluate(() => window.bench.open()));
      await page.evaluate(() => window.bench.gc());
    }
    const input = [],
      scroll = [],
      search = [],
      serialization = [],
      undoRedo = [];
    for (let i = 0; i < inputSamples; i++)
      input.push(await page.evaluate((i) => window.bench.input(i), i));
    for (let i = 0; i < samples; i++) {
      scroll.push(await page.evaluate((i) => window.bench.scroll(i), i));
      search.push(await page.evaluate(() => window.bench.search()));
      serialization.push((await page.evaluate(() => window.bench.serialize())).ms);
      undoRedo.push(await page.evaluate((i) => window.bench.undoRedo(i), i));
    }
    // Memory is a separate cohort; retain required live buffers and all browser descendants.
    await page.evaluate(() => window.bench.gc());
    const reusedSteadyRss = rss(),
      metrics = await page.evaluate(() => window.bench.metrics()),
      memory =
        memoryIsolation === 'per-workload' ? await isolatedMemory(file, reference, metrics) : null,
      sampling = memory ? memory.sampling : await memoryStage(),
      workloadBaselineRss = memory ? memory.baselineRss : baselineRss,
      steadyRss = memory ? memory.steadyRss : reusedSteadyRss,
      peakRss = memory
        ? memory.peakObservedRss
        : sampling
          ? Math.max(steadyRss ?? 0, sampling.peakObservedWorkingSetBytes)
          : null;
    const timing = {
      open: stats(open),
      input: stats(input),
      scroll: stats(scroll),
      search: stats(search),
      serialization: stats(serialization),
      undoRedo: stats(undoRedo),
    };
    const result = {
      name: file,
      file,
      seed: 42,
      fixture: {
        nativeSha256: reference.nativeSha256,
        generatedSha256,
        servedSha256,
        browserPreparedNativeBytes,
        manifest: reference.manifest,
        uiText,
        verificationScope:
          'Native SHA-256 checked on disk and via Node HTTP; actual browser prepare byte count and initial UI text SHA-256/dimensions checked before timing. Native decoding validates embedded text/style hashes.',
      },
      metrics,
      timing,
      memory: {
        ...(memory ?? { strategy: memoryIsolation, browserProcessId: browserPid }),
        baselineRss: workloadBaselineRss,
        steadyRss,
        peakObservedRss: peakRss,
        sampling,
        steadyDeltaMiB:
          steadyRss && workloadBaselineRss ? (steadyRss - workloadBaselineRss) / 1048576 : null,
        peakObservedDeltaMiB:
          peakRss && workloadBaselineRss ? (peakRss - workloadBaselineRss) / 1048576 : null,
      },
      targets: {
        open: timing.open.p95 <= 2000,
        input: timing.input.p95 <= 50 && timing.input.p99 <= 100,
        scroll: timing.scroll.p95 <= 20 && timing.scroll.p99 <= 50,
        search: timing.search.p95 <= 500,
        serialization: timing.serialization.p95 <= 2000,
        undoRedo: timing.undoRedo.p95 <= 50,
        domLines: metrics.domLines <= 500,
        steadyMemory:
          steadyRss && workloadBaselineRss
            ? steadyRss - workloadBaselineRss <= 256 * 1048576
            : null,
        peakMemory:
          peakRss && workloadBaselineRss ? peakRss - workloadBaselineRss <= 512 * 1048576 : null,
      },
    };
    results.push(result);
    console.log(JSON.stringify(result));
    await save();
  }
} catch (error) {
  failure = String(error?.stack ?? error);
  process.exitCode = 1;
  console.error(failure);
} finally {
  sourceHashesAfter = await hashSources(sources).catch((error) => ({ error: String(error) }));
  instrumentationSourceHashesAfter = await hashSources(instrumentationFiles).catch((error) => ({
    error: String(error),
  }));
  if (JSON.stringify(sourceHashesAfter) !== JSON.stringify(sourceHashes)) {
    failure = [failure, 'Source files changed during the benchmark.'].filter(Boolean).join('\n');
    process.exitCode = 1;
  }
  if (
    JSON.stringify(instrumentationSourceHashesAfter) !== JSON.stringify(instrumentationSourceHashes)
  ) {
    failure = [failure, 'Benchmark instrumentation changed during the run.']
      .filter(Boolean)
      .join('\n');
    process.exitCode = 1;
  }
  try {
    await save();
  } finally {
    try {
      await browser?.close();
    } finally {
      try {
        await server?.close();
      } finally {
        await ownedServer?.stop();
      }
    }
  }
}
async function comparison() {
  let before;
  try {
    before = JSON.parse(await readFile(baselinePath, 'utf8'));
  } catch {
    return null;
  }
  const change = (oldValue, newValue) => ({
    before: oldValue,
    after: newValue,
    delta: oldValue == null || newValue == null ? null : newValue - oldValue,
    percent:
      oldValue == null || newValue == null || !oldValue ? null : (newValue / oldValue - 1) * 100,
  });
  return {
    baselineReport: path.relative(repositoryRoot, baselinePath).replaceAll('\\', '/'),
    baselineMeasuredAt: before.measuredAt,
    cohorts: {
      baseline: {
        samples: before.samples,
        inputSamples: before.inputSamples,
        warmup: before.warmup,
      },
      after: { samples, inputSamples, warmup },
    },
    sameBrowser: before.browser === browserVersion,
    sameNode: before.node === process.version,
    sameRam: before.ramBytes === os.totalmem(),
    sameCpu: before.cpu === os.cpus()[0]?.model,
    memoryStrategy: {
      baseline: before.memoryIsolation ?? 'reuse',
      after: memoryIsolation,
      same: (before.memoryIsolation ?? 'reuse') === memoryIsolation,
    },
    interpretation:
      'One cohort per version; percentile deltas are observations, not statistical proof of a performance improvement or regression. RAM is measured on the actual host, not an 8 GiB reference device. Fresh versus reused memory strategies differ in process/allocator lifetime; RAM deltas cannot establish a causal code optimization.',
    results: results.map((after) => {
      const old = before.results.find((value) => value.file === after.file);
      if (!old) return { file: after.file, baselineAvailable: false };
      return {
        file: after.file,
        baselineAvailable: true,
        timing: Object.fromEntries(
          Object.entries(after.timing).map(([metric, values]) => [
            metric,
            {
              p95: change(old.timing[metric].p95, values.p95),
              p99: change(old.timing[metric].p99, values.p99),
            },
          ]),
        ),
        domLines: change(old.metrics.domLines, after.metrics.domLines),
        steadyDeltaMiB: change(old.memory.steadyDeltaMiB, after.memory.steadyDeltaMiB),
        peakObservedDeltaMiB: change(
          old.memory.peakObservedDeltaMiB,
          after.memory.peakObservedDeltaMiB,
        ),
        baselineTargets: old.targets,
        afterTargets: after.targets,
      };
    }),
  };
}
async function save() {
  const complete = !failure && results.length === workloads.length;
  const targets = results.flatMap((result) => Object.values(result.targets));
  const report = {
    measuredAt: new Date().toISOString(),
    status: failure
      ? 'FAILED'
      : !complete
        ? 'IN_PROGRESS'
        : targets.some((target) => target === false)
          ? 'MEASURED_WITH_TARGET_MISSES'
          : targets.some((target) => target === null)
            ? 'MEASURED_WITH_UNVERIFIED_TARGETS'
            : 'MEASURED_TARGETS_PASSED',
    failure,
    sourceHashes,
    sourceHashesAfter,
    instrumentationSourceHashes,
    instrumentationSourceHashesAfter,
    instrumentationUnchangedDuringRun: instrumentationSourceHashesAfter
      ? JSON.stringify(instrumentationSourceHashesAfter) ===
        JSON.stringify(instrumentationSourceHashes)
      : null,
    sourcesUnchangedDuringRun: sourceHashesAfter
      ? JSON.stringify(sourceHashesAfter) === JSON.stringify(sourceHashes)
      : null,
    runtime: ownedServer?.metadata ?? null,
    quick,
    samples,
    inputSamples,
    warmup,
    selectedWorkloads: workloads,
    browser: browserVersion,
    node: process.version,
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    ramBytes: os.totalmem(),
    cpu: os.cpus()[0]?.model,
    viewport: {
      width: 1500,
      height: 2100,
      editorWidth: 1400,
      editorHeight: 2000,
      lineHeight: 20,
      lines: 100,
    },
    memoryIsolation,
    memoryCohort: {
      strategy: memoryIsolation,
      timingBrowserProcessId: browserPid,
      freshBaselinePerWorkload: memoryIsolation === 'per-workload',
      timingBrowserRetainedDuringIsolatedMemory: memoryIsolation === 'per-workload',
      conditioning:
        memoryIsolation === 'per-workload'
          ? 'Fresh empty app, independent native OS baseline, same warmup/open/input/scroll/search/serialization/undo conditioning as timing, then three native serialization samples.'
          : 'Original timing browser reused across workloads, one initial empty-app baseline, then three native serialization samples after each timing cohort.',
    },
    memoryMethod:
      'Windows working-set sum for the launched browser PID and descendants. Memory cohort is separate from timing; nominal 50 ms tree samples during three serializations with actual interval/tree recorded. Observed peak may miss shorter transients; summed lifetime process peaks are supplemental and not simultaneous. JS heap secondary.',
    baseline,
    results,
    comparison: await comparison(),
  };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
}
