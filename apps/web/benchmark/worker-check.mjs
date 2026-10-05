import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  repositoryRoot,
  editorSourceFiles,
  productionServer,
  sourceHashes as hashSources,
} from './production.mjs';
const reportPath = path.resolve(
  repositoryRoot,
  process.env.WORKER_REPORT_FILE ?? 'reports/worker-contract.json',
);
const sources = [
  ...editorSourceFiles,
  'apps/web/src/features/editor/components/WorkerContractHarness.tsx',
  'apps/web/src/features/editor/components/BenchmarkHarness.tsx',
  'apps/web/src/features/editor/benchmark/browser.ts',
  'apps/web/src/app/globals.css',
];
const sourceHashes = await hashSources(sources);
let browser = null,
  ownedServer = null,
  workerInstances = 0;
const workerUrls = new Set();
const pageErrors = [],
  consoleErrors = [];
const report = {
  executedAt: new Date().toISOString(),
  browser: null,
  node: process.version,
  sourceHashes,
  runtime: null,
  scope:
    'Actual Chromium dedicated Web Worker from the production Next.js webpack build, real ReplicaBridge/EditorModel/native codec; no worker mocks and no backend/database mutations.',
  checks: [],
};
try {
  ownedServer = await productionServer({
    port: 5176,
    externalBaseUrl: process.env.WORKER_BASE_URL,
  });
  report.runtime = ownedServer.metadata;
  browser = await chromium.launch({ headless: true });
  report.browser = browser.version();
  const page = await browser.newPage();
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('worker', (worker) => {
    workerInstances++;
    workerUrls.add(worker.url());
  });
  const directResponse = await page.goto(`${ownedServer.baseUrl}/worker-contract`);
  if (directResponse?.status() !== 200)
    throw new Error('Direct worker route did not return HTTP 200.');
  await page.waitForFunction(() => !!window.workerContractImports);
  report.directNavigation = {
    status: 'PASS',
    path: '/worker-contract',
    httpStatus: directResponse.status(),
    hydratedClientBridge: true,
    scope:
      'Diagnostic route; business/public viewer navigation is covered by the separate application E2E suite.',
  };
  report.checks = await page.evaluate(async () => {
    const { ReplicaBridge, EditorModel, TextAdapter, StyleTree, decodeNative } =
      window.workerContractImports;
    const checks = [];
    const assert = (value, message) => {
      if (!value) throw new Error(message);
    };
    const deadline = (promise, label) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`${label}: pending promise did not settle in 5 seconds`)),
          5000,
        );
        promise.then(
          (v) => {
            clearTimeout(timer);
            resolve(v);
          },
          (e) => {
            clearTimeout(timer);
            reject(e);
          },
        );
      });
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const awaitCondition = async (check, label) => {
      const start = performance.now();
      while (!check()) {
        if (performance.now() - start > 5000) throw new Error(`${label}: condition timed out`);
        await wait(1);
      }
    };
    async function check(name, run) {
      const start = performance.now();
      try {
        const evidence = await run();
        checks.push({ name, status: 'PASS', durationMs: performance.now() - start, evidence });
      } catch (error) {
        checks.push({
          name,
          status: 'FAIL',
          durationMs: performance.now() - start,
          error: String(error),
        });
      }
    }
    await check(
      'rapid search cancellation settles superseded requests and retains latest result',
      async () => {
        const text = 'needle\n' + 'x'.repeat(5 * 1024 * 1024) + '\nneedle',
          model = new EditorModel(TextAdapter.from(text)),
          bridge = new ReplicaBridge();
        try {
          bridge.init(model);
          await deadline(bridge.search('needle'), 'warm search');
          const old = bridge.search('not-in-document');
          await wait(1);
          const middle = bridge.search('xxxx'),
            latest = bridge.search('needle');
          const [oldResult, middleResult, result] = await deadline(
            Promise.all([old, middle, latest]),
            'cancelled searches',
          );
          assert(oldResult.revision === -1, 'Old search was not cancelled');
          assert(middleResult.revision === -1, 'Middle search was not cancelled');
          assert(
            result.revision === model.localRevision && result.count === 2,
            'Latest search returned wrong revision or count',
          );
          return {
            utf8Bytes: model.text.utf8Bytes,
            cancelledRevisions: [oldResult.revision, middleResult.revision],
            latestRevision: result.revision,
            matchCount: result.count,
            offsets: result.matches,
          };
        } finally {
          bridge.destroy();
        }
      },
    );
    await check('snapshot pinned at R survives large edit and init at generation R+1', async () => {
      const text = 'needle\n' + 'x'.repeat(5 * 1024 * 1024) + '\nneedle',
        model = new EditorModel(TextAdapter.from(text), StyleTree.uniform(text.length, 3)),
        bridge = new ReplicaBridge();
      try {
        bridge.init(model);
        await deadline(bridge.search('needle'), 'initial ACK');
        const pinned = model.snapshot(),
          oldGeneration = bridge.generation,
          pending = bridge.snapshotFor(pinned),
          insert = 'Y'.repeat(512 * 1024);
        model.replace(0, 0, insert, 5, 'bulk-contract');
        const changes = model.history.at(-1).forward;
        bridge.update(model, changes, [{ from: 0, to: 0, newFrom: 0, newTo: insert.length }]);
        assert(bridge.generation > oldGeneration, 'Large edit did not trigger init');
        const serialized = await deadline(pending, 'pinned snapshot'),
          old = await decodeNative(serialized);
        assert(
          old.text.slice() === text && old.styles.maskAt(0) === 3,
          'Pinned native snapshot contains R+1 content',
        );
        const latest = await deadline(bridge.search('needle'), 'search after init');
        assert(
          latest.count === 2 && latest.matches[0] === insert.length,
          'R+1 replica search is inconsistent',
        );
        const current = await decodeNative(
          await deadline(bridge.snapshot(model), 'current snapshot'),
        );
        assert(current.text.slice() === insert + text, 'Current native snapshot text mismatch');
        assert(
          current.styles.maskAt(0) === 5 && current.styles.maskAt(insert.length) === 3,
          'Current native snapshot styles mismatch',
        );
        return {
          oldGeneration,
          newGeneration: bridge.generation,
          pinnedRevision: pinned.localRevision,
          currentRevision: model.localRevision,
          pinnedNativeBytes: serialized.length,
          currentUtf8Bytes: current.text.utf8Bytes,
          latestMatches: latest.matches,
        };
      } finally {
        bridge.destroy();
      }
    });
    await check(
      '100-transaction backlog resync then mismatch resync preserves replica and encoding',
      async () => {
        const original = 'base|needle',
          model = new EditorModel(
            TextAdapter.from(original),
            StyleTree.uniform(original.length, 1),
          ),
          bridge = new ReplicaBridge();
        try {
          bridge.init(model);
          await deadline(bridge.search('needle'), 'initial ACK');
          const generation = bridge.generation;
          for (let i = 0; i < 120; i++) {
            model.replace(0, 0, 'a', 0, `backlog-${i}`);
            const changes = model.history.at(-1).forward;
            bridge.update(model, changes, [{ from: 0, to: 0, newFrom: 0, newTo: 1 }]);
          }
          assert(bridge.generation > generation, 'Backlog did not resync');
          const result = await deadline(bridge.search('needle'), 'backlog search');
          assert(
            result.count === 1 && result.matches[0] === 125 && result.revision === 120,
            'Backlog result mismatch',
          );
          const beforeMismatch = bridge.generation;
          bridge.worker.postMessage({
            type: 'delta',
            generationId: beforeMismatch,
            baseRevision: -1,
            revision: 999,
            changes: [],
            ranges: [],
          });
          await awaitCondition(
            () => bridge.generation > beforeMismatch,
            'bad base revision resync',
          );
          const after = await deadline(bridge.search('needle'), 'mismatch search'),
            snapshot = await decodeNative(
              await deadline(bridge.snapshot(model), 'backlog snapshot'),
            );
          assert(
            after.count === 1 && after.matches[0] === 125 && after.revision === 120,
            'Mismatch resync lost canonical revision',
          );
          assert(
            snapshot.text.slice() === 'a'.repeat(120) + original,
            'Backlog snapshot text mismatch',
          );
          assert(
            snapshot.styles.maskAt(119) === 0 && snapshot.styles.maskAt(120) === 1,
            'Backlog snapshot styles mismatch',
          );
          return {
            edits: 120,
            resyncGenerations: bridge.generation - generation,
            currentRevision: model.localRevision,
            matchOffset: after.matches[0],
            snapshotUtf8Bytes: snapshot.text.utf8Bytes,
          };
        } finally {
          bridge.destroy();
        }
      },
    );
    await check(
      'bad snapshot revision rejects while valid pinned request survives resync',
      async () => {
        const text = 'snapshot ' + 'a'.repeat(1024 * 1024),
          model = new EditorModel(TextAdapter.from(text)),
          bridge = new ReplicaBridge();
        try {
          bridge.init(model);
          await deadline(bridge.search('snapshot'), 'initial ACK');
          const good = bridge.snapshot(model),
            bad = bridge.snapshotFor({ ...model.snapshot(), localRevision: 999 }),
            outcome = await deadline(
              bad.then(
                () => ({ accepted: true }),
                (error) => ({ accepted: false, error: String(error) }),
              ),
              'invalid revision',
            );
          assert(
            !outcome.accepted && outcome.error.includes('RESYNC'),
            'Bad revision did not reject with RESYNC',
          );
          const decoded = await decodeNative(await deadline(good, 'valid snapshot during resync'));
          assert(decoded.text.slice() === text, 'Valid pinned snapshot lost during resync');
          return {
            invalidRevision: 999,
            rejected: outcome.error,
            retainedBytes: decoded.text.utf8Bytes,
          };
        } finally {
          bridge.destroy();
        }
      },
    );
    await check('destroy settles a search whose ready continuation has not resumed', async () => {
      const model = new EditorModel(TextAdapter.from('close me')),
        bridge = new ReplicaBridge();
      bridge.init(model);
      await deadline(bridge.search('close'), 'initial ACK');
      const pending = bridge.search('absent');
      bridge.destroy();
      const outcome = await deadline(
        pending.then(
          () => ({ accepted: true }),
          (error) => ({ accepted: false, error: String(error) }),
        ),
        'search on destroy',
      );
      assert(
        !outcome.accepted && outcome.error.includes('CLOSED'),
        'Destroyed search did not reject CLOSED',
      );
      return outcome;
    });
    await check('snapshot requested after destroy rejects and does not hang', async () => {
      const model = new EditorModel(TextAdapter.from('closed snapshot')),
        bridge = new ReplicaBridge();
      bridge.init(model);
      await deadline(bridge.search('closed'), 'initial ACK');
      bridge.destroy();
      const outcome = await deadline(
        bridge.snapshot(model).then(
          () => ({ accepted: true }),
          (error) => ({ accepted: false, error: String(error) }),
        ),
        'snapshot after destroy',
      );
      assert(
        !outcome.accepted && outcome.error.includes('CLOSED'),
        'Snapshot on destroyed bridge did not reject CLOSED',
      );
      return outcome;
    });
    return checks;
  });
  report.protocolWorkerInstances = workerInstances;
  const sentinel = await page.evaluate(() => {
    window.lifecycleSentinel = crypto.randomUUID();
    return window.lifecycleSentinel;
  });
  const geometry = [];
  for (let iteration = 0; iteration < 2; iteration++) {
    await page.evaluate(() => window.harnessNavigate('/benchmark'));
    await page.waitForFunction(() => !!window.bench && !window.workerContractImports);
    await page.evaluate(() => window.bench.empty());
    geometry.push(
      await page.evaluate(() => {
        const rect = document.getElementById('editor').getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          lineHeight: getComputedStyle(document.querySelector('.cm-line')).lineHeight,
        };
      }),
    );
    await page.evaluate(() => window.harnessNavigate('/worker-contract'));
    await page.waitForFunction(() => !!window.workerContractImports && !window.bench);
  }
  const closeDeadline = Date.now() + 5000;
  while (page.workers().length && Date.now() < closeDeadline)
    await new Promise((resolve) => setTimeout(resolve, 25));
  if (page.workers().length || (await page.evaluate(() => window.lifecycleSentinel)) !== sentinel)
    throw new Error(
      'App Router lifecycle failed: a worker remained alive or navigation reloaded the page.',
    );
  if (
    geometry.some(
      (value) => value.width !== 1400 || value.height !== 2000 || value.lineHeight !== '20px',
    )
  )
    throw new Error('Benchmark geometry changed during App Router reentry.');
  report.lifecycle = {
    status: 'PASS',
    appRouterNavigations: 4,
    samePageContext: true,
    moduleReentry: true,
    harnessGlobalsCleaned: true,
    remainingDedicatedWorkers: page.workers().length,
    workersCreated: workerInstances - report.protocolWorkerInstances,
    geometry,
  };
  if (report.lifecycle.workersCreated !== 2)
    throw new Error(`Expected two lifecycle workers, observed ${report.lifecycle.workersCreated}.`);
  const hydrationErrors = consoleErrors.filter((error) =>
    /hydration|hydrating|did not match|didn't match|server rendered|minified react error/i.test(
      error,
    ),
  );
  report.hydration = {
    status: !pageErrors.length && !hydrationErrors.length ? 'PASS' : 'FAIL',
    pageErrors,
    hydrationErrors,
    consoleErrors,
  };
  if (pageErrors.length || hydrationErrors.length)
    throw new Error('Production route hydration or JavaScript errors were observed.');
} catch (error) {
  report.checks.push({ name: 'runner', status: 'FAIL', error: String(error?.stack ?? error) });
} finally {
  report.sourceHashesAfter = await hashSources(sources).catch((error) => ({
    error: String(error),
  }));
  report.sourcesUnchangedDuringRun =
    JSON.stringify(sourceHashes) === JSON.stringify(report.sourceHashesAfter);
  report.workerInstances = workerInstances;
  report.workerBundleUrls = [...workerUrls];
  if (!report.sourcesUnchangedDuringRun)
    report.checks.push({
      name: 'source stability',
      status: 'FAIL',
      error: 'Source files changed during worker verification.',
    });
  if (
    report.protocolWorkerInstances !== 6 ||
    ![...workerUrls].every((url) => new URL(url).pathname.startsWith('/_next/'))
  )
    report.checks.push({
      name: 'production worker bundling',
      status: 'FAIL',
      error: `Expected six actual protocol workers; observed ${report.protocolWorkerInstances ?? 0}.`,
    });
  try {
    await browser?.close();
  } finally {
    await ownedServer?.stop();
  }
  await mkdir(path.dirname(reportPath), { recursive: true });
  report.status =
    report.checks.length === 6 && report.checks.every((check) => check.status === 'PASS')
      ? 'PASS'
      : 'FAIL';
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
if (report.status !== 'PASS') process.exitCode = 1;
