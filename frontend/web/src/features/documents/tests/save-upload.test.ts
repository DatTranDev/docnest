import { afterEach, describe, expect, it, vi } from 'vitest';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('native upload and commit protocol', () => {
  it('pins one idempotency key and expected head across an ambiguous commit retry', async () => {
    const commits: RequestInit[] = [];
    let commitAttempts = 0;
    const fetch = vi.fn(async (path: string, options: RequestInit = {}) => {
      if (path.endsWith('/csrf')) return json({ headerName: 'X-CSRF-Token', token: 'csrf' });
      if (path.endsWith('/login')) return json({ accessToken: 'jwt', user: { id: 'u' } });
      if (path.endsWith('/uploads'))
        return json({
          uploadId: 'upload',
          kind: 'LOCAL',
          uploadUrl: '/local-upload',
          requiredHeaders: {
            'Content-Type': 'application/octet-stream',
            'X-Upload-Proof': 'proof',
          },
        });
      if (path === '/local-upload') return new Response(null, { status: 204 });
      commits.push(options);
      if (++commitAttempts === 1) throw new TypeError('Network closed after server commit');
      return json({ version: { id: 'v', revision: 4 }, noChange: false });
    });
    vi.stubGlobal('fetch', fetch);
    const { login } = await import('@/features/auth');
    await login('a@example.test', 'password');
    const { saveNativeVersion } = await import('../api/saveDocument');
    const result = await saveNativeVersion('d', 3, new Uint8Array([1, 2, 3]));
    expect(result.version.revision).toBe(4);
    expect(commits).toHaveLength(2);
    const keys = commits.map((options) => new Headers(options.headers).get('Idempotency-Key'));
    expect(keys[0]).toMatch(/^[a-f\d-]{36}$/);
    expect(keys[1]).toBe(keys[0]);
    expect(commits.map((options) => JSON.parse(options.body as string))).toEqual([
      { uploadId: 'upload', expectedHeadRevision: 3 },
      { uploadId: 'upload', expectedHeadRevision: 3 },
    ]);
    const upload = fetch.mock.calls.find(([path]) => path === '/local-upload')![1]!;
    expect(new Headers(upload.headers).get('Authorization')).toBe('Bearer jwt');
    expect(new Headers(upload.headers).get('X-Upload-Proof')).toBe('proof');
    expect(upload.credentials).toBe('include');
    expect(upload.cache).toBe('no-store');
    expect(new Uint8Array(await (upload.body as Blob).arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    const ticket = fetch.mock.calls.find(([path]) => path.endsWith('/uploads'))![1]!;
    expect(JSON.parse(ticket.body as string)).toEqual({
      expectedHeadRevision: 3,
      nativeBytes: 3,
      nativeSha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
    });
  });

  it('sends only signed headers to GCS and never retries a server conflict', async () => {
    const fetch = vi.fn<(path: string, options?: RequestInit) => Promise<Response>>(
      async (path) => {
        if (path.endsWith('/csrf')) return json({ headerName: 'X-CSRF-Token', token: 'csrf' });
        if (path.endsWith('/login')) return json({ accessToken: 'private-jwt', user: { id: 'u' } });
        if (path.endsWith('/uploads'))
          return json({
            uploadId: 'gcs-upload',
            kind: 'GCS',
            uploadUrl: 'https://storage.example.test/signed',
            requiredHeaders: {
              'Content-Type': 'application/octet-stream',
              'x-goog-meta-proof': 'signed',
            },
          });
        if (path.startsWith('https://storage.example.test/'))
          return new Response(null, { status: 200 });
        return json(
          { code: 'HEAD_REVISION_CONFLICT', message: 'Changed', details: { headRevision: 9 } },
          409,
        );
      },
    );
    vi.stubGlobal('fetch', fetch);
    const { login } = await import('@/features/auth');
    await login('a@example.test', 'password');
    const { saveNativeVersion } = await import('../api/saveDocument');
    await expect(saveNativeVersion('d', 8, new Uint8Array([4]))).rejects.toMatchObject({
      status: 409,
      code: 'HEAD_REVISION_CONFLICT',
    });
    const upload = fetch.mock.calls.find(([path]) => path.startsWith('https:'))![1]!;
    expect(new Headers(upload.headers).has('Authorization')).toBe(false);
    expect(new Headers(upload.headers).get('x-goog-meta-proof')).toBe('signed');
    expect(upload.credentials).toBe('omit');
    expect(fetch.mock.calls.filter(([path]) => path.endsWith('/versions'))).toHaveLength(1);
  });
});
