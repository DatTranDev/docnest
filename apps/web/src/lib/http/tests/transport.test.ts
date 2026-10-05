import { afterEach, describe, expect, it, vi } from 'vitest';
import { bytes, configureAuthentication, request } from '../client';

afterEach(() => {
  vi.unstubAllGlobals();
  configureAuthentication({ accessToken: () => null, refresh: async () => false });
});

describe('private browser transport', () => {
  it('refreshes a rejected access token once and never allows a cached content read', async () => {
    let token = 'expired';
    const refresh = vi.fn(async () => {
      token = 'rotated';
      return true;
    });
    configureAuthentication({ accessToken: () => token, refresh });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([7, 11, 19])));
    vi.stubGlobal('fetch', fetch);

    expect(await bytes('/api/v1/documents/d/versions/1/content', { cache: 'force-cache' })).toEqual(
      new Uint8Array([7, 11, 19]),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new Headers(fetch.mock.calls[0]![1].headers).get('Authorization')).toBe(
      'Bearer expired',
    );
    expect(new Headers(fetch.mock.calls[1]![1].headers).get('Authorization')).toBe(
      'Bearer rotated',
    );
    for (const [, options] of fetch.mock.calls) {
      expect(options.cache).toBe('no-store');
      expect(options.credentials).toBe('include');
    }
  });

  it('omits both account credentials and cookies for a public native download', async () => {
    configureAuthentication({ accessToken: () => 'private-token', refresh: async () => false });
    const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1])));
    vi.stubGlobal('fetch', fetch);
    await bytes('/api/v1/public/shares/public-token/content', {}, false);
    const options = fetch.mock.calls[0]![1] as RequestInit;
    expect(new Headers(options.headers).has('Authorization')).toBe(false);
    expect(options.credentials).toBe('omit');
    expect(options.cache).toBe('no-store');
  });

  it('preserves an API conflict envelope and performs no access refresh for a 409', async () => {
    const refresh = vi.fn(async () => true);
    configureAuthentication({ accessToken: () => 'token', refresh });
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'HEAD_REVISION_CONFLICT',
          message: 'Changed',
          details: { headRevision: 8 },
          traceId: 'trace',
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetch);
    await expect(
      request('/api/v1/documents/d/versions', 'POST', { expectedHeadRevision: 7 }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'HEAD_REVISION_CONFLICT',
      details: { headRevision: 8 },
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(fetch.mock.calls[0]![1].cache).toBe('no-store');
  });
});
