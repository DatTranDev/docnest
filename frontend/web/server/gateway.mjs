import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { Transform, pipeline } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MAX_BODY_BYTES = 32 * 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 130_000;
const HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function port(value, name) {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error(`Invalid ${name}`);
  }
  return Number(value);
}

function origin(value, name) {
  const parsed = new URL(value);
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`Invalid ${name}`);
  }
  return parsed.origin;
}

function address(value) {
  let ip = value;
  if (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  const family = isIP(ip);
  if (family === 4) {
    return {
      family,
      bits: 32,
      value: ip.split('.').reduce((n, part) => (n << 8n) | BigInt(part), 0n),
      text: ip,
    };
  }
  if (family !== 6 || ip.includes('%')) throw new Error('Invalid IP address');
  // IPv4 tails are valid in IPv6 literals; expand them before processing the hextets.
  if (ip.includes('.')) {
    const last = ip.lastIndexOf(':');
    const tail = address(ip.slice(last + 1)).value;
    ip = `${ip.slice(0, last)}:${(tail >> 16n).toString(16)}:${(tail & 65535n).toString(16)}`;
  }
  const halves = ip.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const parts =
    halves.length === 1
      ? left
      : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  return {
    family,
    bits: 128,
    value: parts.reduce((n, part) => (n << 16n) | BigInt(`0x${part}`), 0n),
    text: value,
  };
}

export function parseTrustedProxyCidrs(value = '') {
  if (!value.trim()) return [];
  const entries = value.split(',');
  if (entries.length > 32) throw new Error('Too many trusted proxy CIDRs');
  return entries.map((entry) => {
    const [ip, prefix, ...rest] = entry.trim().split('/');
    const parsed = address(ip);
    if (
      rest.length ||
      !/^\d+$/.test(prefix ?? '') ||
      Number(prefix) < 1 ||
      Number(prefix) > parsed.bits
    ) {
      throw new Error('Invalid trusted proxy CIDR');
    }
    const shift = BigInt(parsed.bits - Number(prefix));
    return { family: parsed.family, shift, network: parsed.value >> shift };
  });
}

function trusted(ip, cidrs) {
  const parsed = address(ip);
  return cidrs.some(
    (cidr) => cidr.family === parsed.family && parsed.value >> cidr.shift === cidr.network,
  );
}

export function loadConfig(env = process.env) {
  const publicPort = port(env.PORT ?? '8080', 'PORT');
  const privatePort = port(env.NEXT_INTERNAL_PORT ?? '3000', 'NEXT_INTERNAL_PORT');
  if (publicPort === privatePort) throw new Error('Public and private ports must differ');
  return {
    publicPort,
    privatePort,
    nextOrigin: `http://127.0.0.1:${privatePort}`,
    identityOrigin: origin(
      env.IDENTITY_INTERNAL_ORIGIN ?? 'http://identity-service:8080',
      'IDENTITY_INTERNAL_ORIGIN',
    ),
    documentOrigin: origin(
      env.DOCUMENT_INTERNAL_ORIGIN ?? 'http://document-service:8080',
      'DOCUMENT_INTERNAL_ORIGIN',
    ),
    processingOrigin: origin(
      env.PROCESSING_INTERNAL_ORIGIN ?? 'http://processing-service:8080',
      'PROCESSING_INTERNAL_ORIGIN',
    ),
    collaborationOrigin: origin(
      env.COLLABORATION_INTERNAL_ORIGIN ?? 'http://collaboration-service:8080',
      'COLLABORATION_INTERNAL_ORIGIN',
    ),
    paymentOrigin: origin(
      env.PAYMENT_INTERNAL_ORIGIN ?? 'http://payment-service:8080',
      'PAYMENT_INTERNAL_ORIGIN',
    ),
    trustedProxyCidrs: parseTrustedProxyCidrs(env.TRUSTED_PROXY_CIDRS ?? ''),
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    maxBodyBytes: MAX_BODY_BYTES,
    nextEntry: resolve(
      env.NEXT_STANDALONE_ENTRY ?? fileURLToPath(new URL('../server.js', import.meta.url)),
    ),
  };
}

function requestPath(raw) {
  if (!raw?.startsWith('/') || raw.startsWith('//') || /[\\\x00-\x20\x7f]/.test(raw)) {
    throw new Error('Invalid request target');
  }
  const rawPath = raw.split('?')[0];
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    throw new Error('Invalid request target');
  }
  if (
    /[\\\x00-\x20\x7f]/.test(decoded) ||
    /%(?:2f|5c|2e|00)/i.test(decoded) ||
    /%2f|%5c/i.test(rawPath)
  ) {
    throw new Error('Ambiguous request target');
  }
  const parsed = new URL(raw, 'http://gateway.invalid');
  const normalized = decodeURIComponent(parsed.pathname).toLowerCase();
  if (normalized.startsWith('/internal') || normalized.startsWith('/actuator')) return null;
  return parsed.pathname + parsed.search;
}

function isPrefix(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function upstreamOrigin(path, config) {
  const pathname = path.split('?')[0];
  if (isPrefix(pathname, '/api/v1/auth') || isPrefix(pathname, '/.well-known'))
    return config.identityOrigin;
  if (isPrefix(pathname, '/api/v1/jobs')) return config.processingOrigin;
  if (isPrefix(pathname, '/api/v1/collaboration')) return config.collaborationOrigin;
  if (isPrefix(pathname, '/api/v1/billing')) return config.paymentOrigin;
  if (isPrefix(pathname, '/api')) return config.documentOrigin;
  return config.nextOrigin;
}

function cleanHeaders(headers) {
  const connectionTokens = String(headers.connection ?? '')
    .toLowerCase()
    .split(',')
    .map((v) => v.trim());
  const cleaned = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !HOP_HEADERS.has(name) && !connectionTokens.includes(name))
      cleaned[name] = value;
  }
  return cleaned;
}

function forwardingHeaders(req, cidrs) {
  const remote = address(req.socket.remoteAddress).text;
  let client = remote;
  let protocol = req.socket.encrypted ? 'https' : 'http';
  if (trusted(remote, cidrs)) {
    const chain = String(req.headers['x-forwarded-for'] ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    if (chain.length > 20) throw new Error('Invalid forwarding headers');
    chain.forEach(address);
    let current = remote;
    for (let i = chain.length - 1; i >= 0 && trusted(current, cidrs); i -= 1) current = chain[i];
    client = address(current).text;
    const forwardedProtocol = req.headers['x-forwarded-proto'];
    if (forwardedProtocol !== undefined) {
      if (!['http', 'https'].includes(forwardedProtocol))
        throw new Error('Invalid forwarding headers');
      protocol = forwardedProtocol;
    }
  }
  return {
    'x-forwarded-for': client,
    'x-real-ip': client,
    'x-forwarded-proto': protocol,
    'x-forwarded-host': req.headers.host,
  };
}

function errorResponse(res, status, code) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const payload = JSON.stringify({ code, message: code, traceId: randomUUID() });
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'private, no-store',
    'referrer-policy': 'no-referrer',
    connection: 'close',
  });
  res.end(payload);
}

async function nextReady(config, isNextAlive) {
  if (!isNextAlive()) return false;
  return new Promise((resolveReady) => {
    const request = http.get(
      `${config.nextOrigin}/`,
      { timeout: 1000, agent: false },
      (response) => {
        response.resume();
        resolveReady(response.statusCode >= 200 && response.statusCode < 400 && isNextAlive());
      },
    );
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolveReady(false));
  });
}

export function createGateway(config, { isNextAlive = () => true } = {}) {
  const server = http.createServer(async (req, res) => {
    let path;
    let forwarding;
    try {
      path = requestPath(req.url);
      forwarding = forwardingHeaders(req, config.trustedProxyCidrs);
    } catch {
      errorResponse(res, 400, 'INVALID_REQUEST');
      req.resume();
      return;
    }
    if (path === null) {
      errorResponse(res, 404, 'NOT_FOUND');
      req.resume();
      return;
    }
    if (path.split('?')[0] === '/healthz') {
      req.resume();
      if (!['GET', 'HEAD'].includes(req.method)) {
        errorResponse(res, 405, 'METHOD_NOT_ALLOWED');
        return;
      }
      const ready = await nextReady(config, isNextAlive);
      if (res.destroyed) return;
      res.writeHead(ready ? 200 : 503, {
        'content-type': 'application/json',
        'cache-control': 'private, no-store',
      });
      res.end(
        req.method === 'HEAD' ? undefined : JSON.stringify({ status: ready ? 'UP' : 'STARTING' }),
      );
      return;
    }
    if (Number(req.headers['content-length'] ?? 0) > config.maxBodyBytes) {
      errorResponse(res, 413, 'PAYLOAD_TOO_LARGE');
      req.resume();
      return;
    }
    const headers = cleanHeaders(req.headers);
    for (const name of Object.keys(headers)) {
      if (name === 'forwarded' || name === 'x-real-ip' || name.startsWith('x-forwarded-'))
        delete headers[name];
    }
    Object.assign(headers, forwarding);
    const target = new URL(path, upstreamOrigin(path, config));
    const transport = target.protocol === 'https:' ? https : http;
    let finished = false;
    let retried = false;
    let count = 0;
    const limited = new Transform({
      transform(chunk, encoding, callback) {
        count += chunk.length;
        if (count > config.maxBodyBytes) callback(new Error('BODY_LIMIT'));
        else callback(null, chunk);
      },
    });
    const fail = (status, code) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      req.unpipe(limited);
      limited.unpipe(upstream);
      upstream.destroy();
      req.resume();
      errorResponse(res, status, code);
    };
    const receive = (response) => {
      if (finished || res.destroyed) {
        response.destroy();
        return;
      }
      const responseHeaders = cleanHeaders(response.headers);
      if (!path.startsWith('/_next/static/'))
        responseHeaders['cache-control'] = 'private, no-store';
      responseHeaders['referrer-policy'] = 'no-referrer';
      responseHeaders['x-content-type-options'] = 'nosniff';
      res.writeHead(response.statusCode, responseHeaders);
      pipeline(response, res, () => {
        finished = true;
        clearTimeout(deadline);
      });
    };
    const deadline = setTimeout(() => fail(504, 'UPSTREAM_TIMEOUT'), config.requestTimeoutMs);
    deadline.unref();
    const send = (fresh = false) => {
      const outgoing = transport.request(
        target,
        { method: req.method, headers, ...(fresh ? { agent: false } : {}) },
        receive,
      );
      outgoing.on('error', (error) => {
        // Node documents a race when a peer closes an idle keep-alive socket.
        // Retry only an empty read before any response, once on a fresh socket.
        const retry =
          !finished &&
          !res.headersSent &&
          !retried &&
          ['GET', 'HEAD'].includes(req.method) &&
          Number(req.headers['content-length'] ?? 0) === 0 &&
          req.headers['transfer-encoding'] === undefined &&
          outgoing.reusedSocket &&
          error.code === 'ECONNRESET';
        if (!finished) {
          // Never log URLs, header values, capabilities or arbitrary error messages.
          const code = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND'].includes(
            error.code,
          )
            ? error.code
            : 'OTHER';
          process.stderr.write(
            JSON.stringify({
              event: 'UPSTREAM_FAILURE',
              code,
              reusedSocket: outgoing.reusedSocket,
              headersSent: res.headersSent,
              retry,
            }) + '\n',
          );
        }
        if (retry) {
          retried = true;
          limited.unpipe(outgoing);
          upstream = send(true);
          upstream.end();
          return;
        }
        fail(502, 'UPSTREAM_UNAVAILABLE');
      });
      return outgoing;
    };
    let upstream = send();
    limited.on('error', () => fail(413, 'PAYLOAD_TOO_LARGE'));
    req.on('aborted', () => {
      finished = true;
      clearTimeout(deadline);
      upstream.destroy();
      limited.destroy();
    });
    req.on('error', () => {
      finished = true;
      clearTimeout(deadline);
      upstream.destroy();
      limited.destroy();
    });
    res.on('close', () => {
      finished = true;
      clearTimeout(deadline);
      // A completed response may already have returned its socket to the agent.
      // Destroying that request can abort the next request which reused the socket.
      if (!res.writableFinished) upstream.destroy();
      limited.destroy();
    });
    req.pipe(limited).pipe(upstream);
  });
  server.requestTimeout = config.requestTimeoutMs;
  server.headersTimeout = Math.min(30_000, config.requestTimeoutMs);
  server.keepAliveTimeout = 5000;
  server.on('upgrade', (_req, socket) =>
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'),
  );
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  return server;
}

export async function launch(env = process.env) {
  const config = loadConfig(env);
  let alive = true;
  let stopping = false;
  // Child output is discarded: URLs, cookies and bearer capabilities must never reach logs.
  const child = spawn(process.execPath, [config.nextEntry], {
    env: {
      ...env,
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      HOSTNAME: '127.0.0.1',
      PORT: String(config.privatePort),
    },
    stdio: 'ignore',
  });
  const server = createGateway(config, { isNextAlive: () => alive });
  const shutdown = async (exitCode) => {
    if (stopping) return;
    stopping = true;
    const closed = new Promise((done) => server.close(done));
    const force = setTimeout(() => {
      server.closeAllConnections();
      child.kill('SIGKILL');
    }, 30_000);
    force.unref();
    await closed;
    alive = false;
    const childClosed = new Promise((done) => {
      if (child.exitCode !== null || child.signalCode !== null) done();
      else child.once('exit', done);
    });
    child.kill('SIGTERM');
    await childClosed;
    clearTimeout(force);
    process.exitCode = exitCode;
  };
  child.once('error', () => {
    alive = false;
    void shutdown(1);
  });
  child.once('exit', () => {
    alive = false;
    if (!stopping) void shutdown(1);
  });
  process.once('SIGTERM', () => {
    void shutdown(0);
  });
  process.once('SIGINT', () => {
    void shutdown(0);
  });
  try {
    await new Promise((done, reject) => {
      server.once('error', reject);
      server.listen(config.publicPort, '0.0.0.0', done);
    });
  } catch (error) {
    stopping = true;
    child.kill('SIGTERM');
    throw error;
  }
  return { server, child, shutdown };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  launch().catch(() => {
    process.stderr.write('WEB_START_FAILED\n');
    process.exitCode = 1;
  });
}
