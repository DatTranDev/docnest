import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createGateway,
  launch,
  loadConfig,
  MAX_BODY_BYTES,
  parseTrustedProxyCidrs,
} from './gateway.mjs';

async function fixture(handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    server,
    origin: `http://127.0.0.1:${server.address().port}`,
    port: server.address().port,
  };
}

async function close(server) {
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}

async function resetFixture(t, resetAgain = false) {
  const calls = [];
  const peer = await fixture((req, res) => {
    const port = req.socket.remotePort;
    req.resume();
    req.on('end', () => {
      calls.push({ method: req.method, port });
      if (calls.length === 2 || (resetAgain && calls.length === 3)) {
        req.socket.destroy();
        return;
      }
      res.end('complete-native');
    });
  });
  const gateway = createGateway({ ...loadConfig(), documentOrigin: peer.origin });
  gateway.listen(0, '127.0.0.1');
  await once(gateway, 'listening');
  t.after(async () => {
    await close(gateway);
    await close(peer.server);
  });
  return {
    calls,
    url: `http://127.0.0.1:${gateway.address().port}/api/v1/documents/native/content`,
  };
}

test('empty reads recover once from a reset reused socket before response headers', async (t) => {
  for (const method of ['GET', 'HEAD']) {
    const peer = await resetFixture(t);
    assert.equal((await request(peer.url)).status, 200);
    const response = await request(peer.url, { method });
    assert.equal(response.status, 200);
    assert.equal(response.body, method === 'HEAD' ? '' : 'complete-native');
    assert.equal(peer.calls.length, 3);
    assert.equal(peer.calls[0].port, peer.calls[1].port, 'reset request reused its socket');
    assert.notEqual(peer.calls[1].port, peer.calls[2].port, 'retry uses a fresh socket');
  }
});

test('reset mutating requests and reads with bodies are never replayed', async (t) => {
  for (const method of ['POST', 'PUT', 'GET']) {
    const peer = await resetFixture(t);
    await request(peer.url);
    const response = await request(peer.url, {
      method,
      body: 'native-upload-body',
      headers: { 'content-length': '18' },
    });
    assert.equal(response.status, 502);
    assert.equal(peer.calls.length, 2);
    assert.equal(peer.calls[0].port, peer.calls[1].port);
  }
});

test('an empty read failing again on its fresh socket does not loop', async (t) => {
  const peer = await resetFixture(t, true);
  await request(peer.url);
  assert.equal((await request(peer.url)).status, 502);
  assert.equal(peer.calls.length, 3);
});

async function request(url, { method = 'GET', headers = {}, bytes = 0, body, onChunk } = {}) {
  return new Promise((done, reject) => {
    const req = http.request(url, { method, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => {
        onChunk?.(chunk);
        chunks.push(chunk);
      });
      response.on('end', () =>
        done({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString(),
        }),
      );
      response.on('error', reject);
    });
    req.on('error', reject);
    if (body !== undefined) {
      req.end(body);
      return;
    }
    void (async () => {
      let left = bytes;
      const chunk = Buffer.alloc(Math.min(left, 256 * 1024), 65);
      while (left > 0 && !req.destroyed) {
        const take = Math.min(left, chunk.length);
        left -= take;
        if (!req.write(chunk.subarray(0, take)))
          await new Promise((resume) => {
            const ready = () => {
              req.off('drain', ready);
              req.off('close', ready);
              resume();
            };
            req.once('drain', ready);
            req.once('close', ready);
          });
      }
      req.end();
    })().catch(reject);
  });
}

async function environment(t, overrides = {}, options = {}) {
  const calls = [];
  const servers = [];
  const peers = {};
  for (const name of ['identity', 'document', 'processing', 'collaboration', 'payment', 'next']) {
    peers[name] = await fixture((req, res) => {
      calls.push({ name, path: req.url, headers: req.headers });
      let count = 0;
      req.on('data', (chunk) => {
        count += chunk.length;
      });
      req.on('end', () => {
        if (req.url === '/hang') return;
        if (req.url === '/stream') {
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.write('first');
          setTimeout(() => res.end('last'), 70);
          return;
        }
        res.writeHead(name === 'identity' ? 201 : 200, {
          'content-type': 'application/json',
          'cache-control': 'public, max-age=3600',
          'set-cookie': ['refresh=fixture; HttpOnly; SameSite=Lax', 'csrf=fixture; SameSite=Lax'],
          'content-disposition': 'attachment; filename="fixture.txt"',
        });
        res.end(JSON.stringify({ name, count, path: req.url }));
      });
    });
    servers.push(peers[name].server);
  }
  const config = {
    ...loadConfig(),
    nextOrigin: peers.next.origin,
    identityOrigin: peers.identity.origin,
    documentOrigin: peers.document.origin,
    processingOrigin: peers.processing.origin,
    collaborationOrigin: peers.collaboration.origin,
    paymentOrigin: peers.payment.origin,
    ...overrides,
  };
  const server = createGateway(config, options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await close(server);
    for (const peer of servers) await close(peer);
  });
  return { url: `http://127.0.0.1:${server.address().port}`, calls, peers, config };
}

test('completed streamed responses preserve pooled upstream sockets for the next request', async (t) => {
  const upstreamPorts = new Set();
  const peer = await fixture((req, res) => {
    upstreamPorts.add(req.socket.remotePort);
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.write('native-');
      setImmediate(() => res.end('bytes'));
    });
  });
  const config = { ...loadConfig(), documentOrigin: peer.origin };
  const gateway = createGateway(config);
  gateway.listen(0, '127.0.0.1');
  await once(gateway, 'listening');
  t.after(async () => {
    await close(gateway);
    await close(peer.server);
  });
  const url = `http://127.0.0.1:${gateway.address().port}/api/v1/documents/fixture/content`;
  for (let i = 0; i < 50; i += 1) {
    const response = await request(url);
    assert.equal(response.status, 200);
    assert.equal(response.body, 'native-bytes');
  }
  assert.ok(
    upstreamPorts.size <= 2,
    `Expected pooled connection reuse; observed ${upstreamPorts.size} sockets`,
  );
});

test('routes six actual HTTP origins, preserves protocol fields and multiple cookies', async (t) => {
  const env = await environment(t);
  for (const [path, name] of [
    ['/api/v1/auth/login', 'identity'],
    ['/.well-known/jwks.json', 'identity'],
    ['/api/v1/jobs/a', 'processing'],
    ['/api/v1/collaboration/a/updates', 'collaboration'],
    ['/api/v1/billing/webhooks/stripe', 'payment'],
    ['/api/v1/documents/a', 'document'],
    ['/', 'next'],
  ]) {
    const response = await request(env.url + path, {
      headers: {
        authorization: 'Bearer synthetic-fixture',
        cookie: 'csrf=fixture; refresh=fixture',
        'x-csrf-token': 'fixture',
        'idempotency-key': 'fixture-key',
        origin: 'https://fixture.example',
        'x-forwarded-for': '203.0.113.99',
        'x-forwarded-proto': 'https',
        forwarded: 'for=203.0.113.99',
      },
    });
    assert.equal(JSON.parse(response.body).name, name);
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.equal(response.headers['set-cookie'].length, 2);
    assert.equal(response.headers['content-disposition'], 'attachment; filename="fixture.txt"');
    const call = env.calls.at(-1);
    assert.equal(call.headers.authorization, 'Bearer synthetic-fixture');
    assert.equal(call.headers.cookie, 'csrf=fixture; refresh=fixture');
    assert.equal(call.headers['x-csrf-token'], 'fixture');
    assert.equal(call.headers['idempotency-key'], 'fixture-key');
    assert.equal(call.headers.origin, 'https://fixture.example');
    assert.equal(call.headers['x-forwarded-for'], '127.0.0.1');
    assert.equal(call.headers['x-forwarded-proto'], 'http');
    assert.equal(call.headers.forwarded, undefined);
  }
});

test('rejects private routes, canonical traversal and ambiguous paths before forwarding', async (t) => {
  const env = await environment(t);
  for (const path of [
    '/internal/v1/users',
    '/actuator/health',
    '/%69nternal/test',
    '/x/%2e%2e/actuator/health',
    '/INTERNAL',
  ]) {
    assert.equal((await request(env.url + path)).status, 404, path);
  }
  for (const path of ['/api%2Finternal', '/%252e%252e/internal', '/%00', '/%zz']) {
    assert.equal((await request(env.url + path)).status, 400, path);
  }
  assert.equal(env.calls.length, 0);
});

test('validated trusted proxies choose the rightmost untrusted peer and reject malformed chains', async (t) => {
  const env = await environment(t, {
    trustedProxyCidrs: parseTrustedProxyCidrs('127.0.0.1/32,10.1.0.0/16,::1/128'),
  });
  await request(`${env.url}/api/v1/documents/a`, {
    headers: {
      'x-forwarded-for': '203.0.113.99, 198.51.100.17, 10.1.2.3',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'attacker.invalid',
      'x-real-ip': '203.0.113.99',
    },
  });
  assert.equal(env.calls.at(-1).headers['x-forwarded-for'], '198.51.100.17');
  assert.equal(env.calls.at(-1).headers['x-real-ip'], '198.51.100.17');
  assert.equal(env.calls.at(-1).headers['x-forwarded-proto'], 'https');
  assert.notEqual(env.calls.at(-1).headers['x-forwarded-host'], 'attacker.invalid');
  assert.equal(
    (
      await request(`${env.url}/api/v1/documents/a`, {
        headers: { 'x-forwarded-for': 'not-an-ip' },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(`${env.url}/api/v1/documents/a`, {
        headers: { 'x-forwarded-proto': 'https,http' },
      })
    ).status,
    400,
  );
});

test('configuration rejects broad, malformed and credential-bearing destinations', () => {
  for (const cidr of [
    '0.0.0.0/0',
    '::/0',
    '*',
    'localhost/32',
    '10.0.0.0/33',
    '::1/129',
    '10.0.0.1',
    '10.0.0.1/32/2',
  ]) {
    assert.throws(() => parseTrustedProxyCidrs(cidr), undefined, cidr);
  }
  assert.equal(parseTrustedProxyCidrs('2001:db8::/32,127.0.0.1/32').length, 2);
  for (const value of [
    'http://user:pass@localhost:8081',
    'http://localhost:8081/path',
    'ftp://localhost',
    'http://localhost?a=b',
  ]) {
    assert.throws(() => loadConfig({ IDENTITY_INTERNAL_ORIGIN: value }));
  }
  assert.throws(() => loadConfig({ PORT: '3000', NEXT_INTERNAL_PORT: '3000' }));
});

test('readiness actually probes Next and fails when child or HTTP server is unavailable', async (t) => {
  let alive = true;
  const env = await environment(t, {}, { isNextAlive: () => alive });
  assert.equal((await request(`${env.url}/healthz`)).status, 200);
  assert.equal(env.calls.at(-1).name, 'next');
  alive = false;
  assert.equal((await request(`${env.url}/healthz`)).status, 503);
  alive = true;
  await close(env.peers.next.server);
  assert.equal((await request(`${env.url}/healthz`)).status, 503);
});

test('enforces the actual 32 MiB boundary for fixed-length and chunked request streams', async (t) => {
  const env = await environment(t);
  const tooLarge = await request(`${env.url}/api/v1/documents/upload`, {
    method: 'PUT',
    headers: { 'content-length': String(MAX_BODY_BYTES + 1) },
  });
  assert.equal(tooLarge.status, 413);
  assert.equal(env.calls.length, 0);
  const exact = await request(`${env.url}/api/v1/documents/upload`, {
    method: 'PUT',
    bytes: MAX_BODY_BYTES,
    headers: { 'content-length': String(MAX_BODY_BYTES) },
  });
  assert.equal(exact.status, 200);
  assert.equal(JSON.parse(exact.body).count, MAX_BODY_BYTES);
  const chunked = await request(`${env.url}/api/v1/documents/upload`, {
    method: 'PUT',
    bytes: MAX_BODY_BYTES + 1,
  });
  assert.equal(chunked.status, 413);
});

test('streams responses before completion and bounds upstream failures and timeouts', async (t) => {
  const env = await environment(t, { requestTimeoutMs: 150 });
  const seen = [];
  const response = await request(`${env.url}/stream`, {
    onChunk: (chunk) => seen.push({ text: chunk.toString(), time: Date.now() }),
  });
  assert.equal(response.body, 'firstlast');
  assert.equal(seen[0].text, 'first');
  assert.ok(seen.at(-1).time - seen[0].time >= 40);
  assert.equal((await request(`${env.url}/hang`)).status, 504);
  await close(env.peers.document.server);
  assert.equal((await request(`${env.url}/api/v1/documents/a`)).status, 502);
});

test('launches a real private child, probes readiness, drains and closes both listeners', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'editor-gateway-'));
  const entry = join(temp, 'server.cjs');
  await writeFile(
    entry,
    "const http=require('node:http');const s=http.createServer((q,r)=>r.end('fixture-next'));s.listen(Number(process.env.PORT),process.env.HOSTNAME);process.on('SIGTERM',()=>s.close(()=>process.exit(0)));\n",
  );
  const publicProbe = await fixture((_q, r) => r.end());
  const privateProbe = await fixture((_q, r) => r.end());
  const publicPort = publicProbe.port;
  const privatePort = privateProbe.port;
  await close(publicProbe.server);
  await close(privateProbe.server);
  const runtime = await launch({
    ...process.env,
    PORT: String(publicPort),
    NEXT_INTERNAL_PORT: String(privatePort),
    NEXT_STANDALONE_ENTRY: entry,
    TRUSTED_PROXY_CIDRS: '',
  });
  t.after(async () => {
    await runtime.shutdown(0);
    await rm(temp, { recursive: true });
  });
  let status = 503;
  for (let i = 0; i < 40 && status !== 200; i += 1) {
    status = (await request(`http://127.0.0.1:${publicPort}/healthz`)).status;
    if (status !== 200) await new Promise((done) => setTimeout(done, 25));
  }
  assert.equal(status, 200);
  assert.equal((await request(`http://127.0.0.1:${publicPort}/`)).body, 'fixture-next');
  await runtime.shutdown(0);
  assert.ok(runtime.child.exitCode !== null || runtime.child.signalCode !== null);
  await assert.rejects(request(`http://127.0.0.1:${publicPort}/`));
  await assert.rejects(request(`http://127.0.0.1:${privatePort}/`));
});
