import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

export const appRoot = path.resolve(import.meta.dirname, '../../frontend/web');
export const repositoryRoot = path.resolve(appRoot, '../..');
const nextCli = path.join(repositoryRoot, 'node_modules/next/dist/bin/next');
export const editorSourceFiles = [
  'frontend/web/src/features/editor/model/EditorController.ts',
  'frontend/web/src/features/editor/model/ReplicaBridge.ts',
  'frontend/web/src/features/editor/model/worker.ts',
  'frontend/web/src/features/editor/model/DraftStore.ts',
  'frontend/web/src/features/editor/model/viewportStyles.ts',
  'frontend/editor-core/src/model.ts',
  'frontend/editor-core/src/style.ts',
  'frontend/editor-core/src/text.ts',
  'frontend/editor-core/src/codec.ts',
];
export async function sourceHashes(files = editorSourceFiles) {
  return Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [
        file,
        createHash('sha256')
          .update(await readFile(path.join(repositoryRoot, file)))
          .digest('hex'),
      ]),
    ),
  );
}
function exitResult(child) {
  return new Promise((resolve) => {
    child.once('error', (error) => resolve({ code: null, error: String(error) }));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}
async function buildProduction() {
  const child = spawn(process.execPath, [nextCli, 'build', '--webpack'], {
    cwd: appRoot,
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });
  const result = await exitResult(child);
  if (result.code !== 0) throw new Error(`Next production build failed: ${JSON.stringify(result)}`);
}
async function requireFreePort(port) {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}
export async function productionServer({ port, externalBaseUrl }) {
  const next = JSON.parse(
    await readFile(path.join(repositoryRoot, 'node_modules/next/package.json'), 'utf8'),
  );
  if (externalBaseUrl) {
    const url = new URL(externalBaseUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        'The external benchmark URL must use HTTP(S) without credentials/query/fragment.',
      );
    return {
      baseUrl: externalBaseUrl.replace(/\/$/, ''),
      metadata: { mode: 'external', expectedFramework: 'Next.js', installedVersion: next.version },
      stop: async () => {},
    };
  }
  await requireFreePort(port);
  await buildProduction();
  const child = spawn(
    process.execPath,
    [nextCli, 'start', '--hostname', '127.0.0.1', '--port', String(port)],
    {
      cwd: appRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    },
  );
  const completion = exitResult(child);
  let completed = null,
    ready = false,
    output = '';
  void completion.then((value) => {
    completed = value;
  });
  const collect = (chunk) => {
    const text = chunk.toString();
    output = (output + text).slice(-16384);
    if (text.includes('Ready in')) ready = true;
    process.stdout.write(text);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const stop = async () => {
    if (completed) return;
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    try {
      await completion;
    } finally {
      clearTimeout(timer);
    }
  };
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (completed)
        throw new Error(
          `Owned Next server exited before readiness: ${JSON.stringify(completed)}\n${output}`,
        );
      if (ready) {
        try {
          const response = await fetch(`${baseUrl}/healthz`, {
            signal: AbortSignal.timeout(2000),
            cache: 'no-store',
          });
          if (response.ok)
            return {
              baseUrl,
              metadata: {
                mode: 'owned',
                framework: 'Next.js',
                version: next.version,
                bundler: 'webpack',
                processId: child.pid,
                port,
              },
              stop,
            };
        } catch {
          /* The process may have logged readiness before its first health response. */
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Owned Next server did not become healthy in 60 seconds.\n${output}`);
  } catch (error) {
    await stop();
    throw error;
  }
}
