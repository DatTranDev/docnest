import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { createGateway, loadConfig } from './gateway.mjs';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);

export function remoteDevelopment(environment) {
  const remote = new URL(
    environment.REMOTE_BACKEND_ORIGIN ?? 'https://k8s.docsnest.dattrandev.id.vn',
  );
  if (
    remote.protocol !== 'https:' ||
    remote.username ||
    remote.password ||
    remote.pathname !== '/' ||
    remote.search ||
    remote.hash
  ) {
    throw new Error('REMOTE_BACKEND_ORIGIN must be an HTTPS origin without credentials or a path.');
  }
  const config = loadConfig({
    ...environment,
    TRUSTED_PROXY_CIDRS: '',
    IDENTITY_INTERNAL_ORIGIN: remote.origin,
    DOCUMENT_INTERNAL_ORIGIN: remote.origin,
    PROCESSING_INTERNAL_ORIGIN: remote.origin,
    COLLABORATION_INTERNAL_ORIGIN: remote.origin,
    PAYMENT_INTERNAL_ORIGIN: remote.origin,
  });
  const localOrigins = new Set([
    `http://localhost:${config.publicPort}`,
    `http://127.0.0.1:${config.publicPort}`,
  ]);
  const development = {
    validate(req) {
      const local = `http://${req.headers.host}`;
      if (
        !localOrigins.has(local) ||
        (req.headers.origin !== undefined && req.headers.origin !== local) ||
        (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== local)
      ) {
        throw new Error('Only same-origin loopback requests are accepted.');
      }
    },
    forward(headers, target) {
      headers.host = target.host;
      delete headers['x-dev-upload-url'];
      if (target.origin === remote.origin) {
        headers.origin = remote.origin;
        if (headers.referer) headers.referer = `${remote.origin}/`;
      } else {
        headers.origin = remote.origin;
        delete headers.referer;
        delete headers.cookie;
        delete headers.authorization;
      }
      for (const key of Object.keys(headers)) {
        if (key === 'forwarded' || key === 'x-real-ip' || key.startsWith('x-forwarded-')) {
          delete headers[key];
        }
      }
    },
    target(req, path) {
      if (path !== '/__dev/storage-upload') return undefined;
      const value = req.headers['x-dev-upload-url'];
      if (req.method !== 'PUT' || typeof value !== 'string' || value.length > 8192) {
        throw new Error('Invalid development upload.');
      }
      const url = new URL(value);
      const signed =
        url.searchParams.get('X-Goog-Algorithm') === 'GOOG4-RSA-SHA256' &&
        url.searchParams.has('X-Goog-Credential') &&
        url.searchParams.has('X-Goog-Signature');
      const resumable =
        /^\/upload\/storage\/v1\/b\/[^/]+\/o$/.test(url.pathname) &&
        Boolean(url.searchParams.get('upload_id'));
      if (
        url.protocol !== 'https:' ||
        url.host !== 'storage.googleapis.com' ||
        url.username ||
        url.password ||
        url.hash ||
        (!signed && !resumable)
      ) {
        throw new Error('Only Google Storage upload capabilities are supported.');
      }
      return url;
    },
    response(headers) {
      if (headers['set-cookie']) {
        // Scope deployed cookies to loopback HTTP; retain HttpOnly, SameSite and Path.
        headers['set-cookie'] = headers['set-cookie'].map((cookie) =>
          cookie.replace(/;\s*Secure\b/gi, '').replace(/;\s*Domain=[^;]*/gi, ''),
        );
      }
      delete headers['strict-transport-security'];
      delete headers['alt-svc'];
    },
  };
  return { config, development };
}

export async function launchRemote(environment = process.env) {
  let fileEnvironment = {};
  try {
    fileEnvironment = parseEnv(await readFile(resolve(webRoot, '.env.remote.local'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const env = { ...fileEnvironment, ...environment };
  if (env.NODE_ENV === 'production') throw new Error('dev:remote is for local development only.');
  const { config, development } = remoteDevelopment(env);
  const child = spawn(
    process.execPath,
    [
      require.resolve('next/dist/bin/next'),
      'dev',
      '--webpack',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(config.privatePort),
    ],
    {
      cwd: webRoot,
      env: {
        ...env,
        NODE_ENV: 'development',
        NEXT_TELEMETRY_DISABLED: '1',
        NEXT_PUBLIC_REMOTE_BACKEND_PROXY: '1',
      },
      // Next request logs can contain share tokens; errors remain visible in its browser overlay.
      stdio: 'ignore',
    },
  );
  const server = createGateway(config, { development, isNextAlive: () => child.exitCode === null });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    server.closeUpgradedConnections();
    server.closeAllConnections();
    server.close();
    child.kill('SIGTERM');
  };
  child.once('error', () => {
    process.exitCode = 1;
    shutdown();
  });
  child.once('exit', (code) => {
    if (!stopping) process.exitCode = code ?? 1;
    shutdown();
  });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    await new Promise((done, reject) => {
      server.once('error', reject);
      server.listen(config.publicPort, '127.0.0.1', done);
    });
  } catch (error) {
    shutdown();
    throw error;
  }
  process.stdout.write(
    `Frontend: http://localhost:${config.publicPort}\nBackend: ${config.identityOrigin}\nRemote account data is live. Stop with Ctrl+C.\n`,
  );
  return { server, child, shutdown };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  launchRemote().catch(() => {
    process.stderr.write(
      'REMOTE_DEV_START_FAILED: check the remote origin, ports and local configuration.\n',
    );
    process.exitCode = 1;
  });
}
