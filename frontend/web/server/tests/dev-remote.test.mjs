import assert from 'node:assert/strict';
import { test } from 'node:test';
import { remoteDevelopment } from '../dev-remote.mjs';
import { loadConfig } from '../gateway.mjs';

const { config, development } = remoteDevelopment({});
const request = (headers = {}, method = 'GET') => ({
  method,
  headers: { host: 'localhost:8080', ...headers },
});

test('remote configuration is explicit, HTTPS-only and separate from production defaults', () => {
  assert.equal(config.identityOrigin, 'https://k8s.docsnest.dattrandev.id.vn');
  assert.equal(config.collaborationOrigin, config.identityOrigin);
  assert.equal(loadConfig({}).identityOrigin, 'http://identity-service:8080');
  for (const value of [
    'http://example.test',
    'https://user:secret@example.test',
    'https://example.test/api',
    'https://example.test?key=value',
  ]) {
    assert.throws(() => remoteDevelopment({ REMOTE_BACKEND_ORIGIN: value }));
  }
});

test('loopback policy rejects foreign hosts, cross-origin and originless writes before rewriting', () => {
  development.validate(request());
  development.validate(request({ origin: 'http://localhost:8080' }, 'POST'));
  for (const req of [
    request({ host: 'attacker.test:8080' }),
    request({ origin: 'https://attacker.test' }),
    request({ origin: 'null' }),
    request({}, 'POST'),
  ]) {
    assert.throws(() => development.validate(req));
  }
});

test('backend forwarding preserves signed CSRF and authorization but discards spoofed forwarding', () => {
  const headers = {
    host: 'localhost:8080',
    origin: 'http://localhost:8080',
    cookie: 'fictional',
    authorization: 'Bearer fictional',
    'x-csrf-token': 'fictional',
    'x-forwarded-for': 'spoofed',
  };
  development.forward(headers, new URL(config.identityOrigin));
  assert.equal(headers.host, new URL(config.identityOrigin).host);
  assert.equal(headers.origin, config.identityOrigin);
  assert.equal(headers['x-csrf-token'], 'fictional');
  assert.equal(headers.cookie, 'fictional');
  assert.equal(headers.authorization, 'Bearer fictional');
  assert.equal(headers['x-forwarded-for'], undefined);
  const response = {
    'set-cookie': [
      'refresh_token=fictional; Domain=example.test; Path=/api/v1/auth; Secure; HttpOnly; SameSite=Lax; Max-Age=0',
    ],
    'strict-transport-security': 'max-age=1',
    'alt-svc': 'h3',
  };
  development.response(response);
  assert.equal(
    response['set-cookie'][0],
    'refresh_token=fictional; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Max-Age=0',
  );
  assert.equal(response['strict-transport-security'], undefined);
});

test('storage proxy permits only signed/resumable GCS PUT and forwards no application credentials', () => {
  const signed =
    'https://storage.googleapis.com/bucket/object?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=fictional&X-Goog-Signature=fictional';
  const req = request({ 'x-dev-upload-url': signed }, 'PUT');
  const target = development.target(req, '/__dev/storage-upload');
  assert.equal(target.href, signed);
  const resumable =
    'https://storage.googleapis.com/upload/storage/v1/b/bucket/o?uploadType=resumable&upload_id=fictional';
  assert.equal(
    development.target(request({ 'x-dev-upload-url': resumable }, 'PUT'), '/__dev/storage-upload')
      .href,
    resumable,
  );
  for (const url of [
    'http://127.0.0.1/private',
    'https://storage.googleapis.com/unsigned',
    signed.replace('storage.googleapis.com', 'attacker.test'),
  ]) {
    assert.throws(() =>
      development.target(request({ 'x-dev-upload-url': url }, 'PUT'), '/__dev/storage-upload'),
    );
  }
  assert.throws(() =>
    development.target(request({ 'x-dev-upload-url': signed }), '/__dev/storage-upload'),
  );
  const headers = {
    cookie: 'fictional',
    authorization: 'Bearer fictional',
    origin: 'http://localhost:8080',
    'x-dev-upload-url': signed,
    'content-type': 'application/octet-stream',
  };
  development.forward(headers, target);
  for (const name of ['cookie', 'authorization', 'x-dev-upload-url'])
    assert.equal(headers[name], undefined);
  assert.equal(headers.origin, config.identityOrigin);
  assert.equal(headers.host, 'storage.googleapis.com');
  assert.equal(headers['content-type'], 'application/octet-stream');
});
