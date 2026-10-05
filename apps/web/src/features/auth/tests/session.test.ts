import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
describe('CSRF and in-memory token protocol', () => {
  it('renews a rejected CSRF exactly once after a server restart', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ headerName: 'X-CSRF-Token', token: 'old' }))
      .mockResolvedValueOnce(json({ code: 'CSRF_INVALID', message: 'expired', traceId: '1' }, 403))
      .mockResolvedValueOnce(json({ headerName: 'X-CSRF-Token', token: 'fresh' }))
      .mockResolvedValueOnce(
        json({ accessToken: 'jwt', user: { id: 'u', email: 'a@example.test', displayName: 'A' } }),
      );
    vi.stubGlobal('fetch', fetch);
    const api = await import('../api/auth');
    await api.login('a@example.test', 'long-password');
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls[1]![1].headers['X-CSRF-Token']).toBe('old');
    expect(fetch.mock.calls[3]![1].headers['X-CSRF-Token']).toBe('fresh');
  });
  it('does not retry wrong credentials or loop when renewed CSRF is rejected', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ headerName: 'X-CSRF-Token', token: 'a' }))
      .mockResolvedValueOnce(
        json({ code: 'INVALID_CREDENTIALS', message: 'no', traceId: '1' }, 401),
      );
    vi.stubGlobal('fetch', fetch);
    const api = await import('../api/auth');
    await expect(api.login('a@example.test', 'bad')).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('shares one refresh and fetches fresh CSRF across concurrent requests', async () => {
    const fetch = vi.fn(async (path: string) => {
      if (path.endsWith('/csrf')) return json({ headerName: 'X-CSRF-Token', token: 'fresh' });
      await new Promise((r) => setTimeout(r, 5));
      return json({
        accessToken: 'rotated',
        user: { id: 'u', email: 'a@example.test', displayName: 'A' },
      });
    });
    vi.stubGlobal('fetch', fetch);
    const api = await import('../api/auth');
    const [a, b] = await Promise.all([api.refresh(), api.refresh()]);
    expect(a).toBe(b);
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      '/api/v1/auth/csrf',
      '/api/v1/auth/refresh',
    ]);
  });
  it('shares one in-flight CSRF cookie/header pair across refresh and registration', async () => {
    const csrfResponse = deferred<Response>();
    const fetch = vi.fn<(path: string, options?: RequestInit) => Promise<Response>>(
      async (path) => {
        if (path.endsWith('/csrf')) return csrfResponse.promise;
        if (path.endsWith('/register')) return new Response(null, { status: 204 });
        return json({ accessToken: 'refreshed', user: { id: 'u' } });
      },
    );
    vi.stubGlobal('fetch', fetch);
    const api = await import('../api/auth');
    const refresh = api.refresh();
    const registration = api.register('b@example.test', 'long-password', 'B');
    expect(fetch.mock.calls.filter(([path]) => path.endsWith('/csrf'))).toHaveLength(1);
    csrfResponse.resolve(json({ headerName: 'X-CSRF-Token', token: 'shared' }));
    await Promise.all([refresh, registration]);
    const mutations = fetch.mock.calls.filter(([path]) => !path.endsWith('/csrf'));
    expect(mutations).toHaveLength(2);
    for (const [, options] of mutations) {
      expect(new Headers(options!.headers).get('X-CSRF-Token')).toBe('shared');
    }
  });

  it('does not resurrect a session when a refresh response arrives after logout', async () => {
    const refreshResponse = deferred<Response>();
    const refreshStarted = deferred<void>();
    const fetch = vi.fn(async (path: string) => {
      if (path.endsWith('/csrf')) return json({ headerName: 'X-CSRF-Token', token: 'csrf' });
      if (path.endsWith('/refresh')) {
        refreshStarted.resolve();
        return refreshResponse.promise;
      }
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', fetch);
    const api = await import('../api/auth');
    const refreshing = api.refresh();
    await refreshStarted.promise;
    const loggingOut = api.logout();
    refreshResponse.resolve(json({ accessToken: 'late-token', user: { id: 'u' } }));
    expect(await refreshing).toBeNull();
    await loggingOut;
    expect(api.currentSession()).toBeNull();
  });

  it('blocks refresh during logout and waits for its cookie-clearing response before a new login', async () => {
    const logoutResponse = deferred<Response>();
    const logoutStarted = deferred<void>();
    let loginRequests = 0;
    const fetch = vi.fn(async (path: string) => {
      if (path.endsWith('/csrf')) return json({ headerName: 'X-CSRF-Token', token: 'csrf' });
      if (path.endsWith('/logout')) {
        logoutStarted.resolve();
        return logoutResponse.promise;
      }
      if (path.endsWith('/refresh')) throw new Error('Refresh must not be sent during logout');
      return json({ accessToken: `login-${++loginRequests}`, user: { id: 'u' } });
    });
    vi.stubGlobal('fetch', fetch);
    const api = await import('../api/auth');
    await api.login('a@example.test', 'password');
    const loggingOut = api.logout();
    await logoutStarted.promise;
    expect(await api.refresh()).toBeNull();
    const loggingIn = api.login('b@example.test', 'password');
    expect(loginRequests).toBe(1);
    logoutResponse.resolve(new Response(null, { status: 204 }));
    await loggingOut;
    expect((await loggingIn).accessToken).toBe('login-2');
    expect(api.currentSession()?.accessToken).toBe('login-2');
    expect(
      fetch.mock.calls.filter(([path]) => !path.endsWith('/csrf')).map(([path]) => path),
    ).toEqual(['/api/v1/auth/login', '/api/v1/auth/logout', '/api/v1/auth/login']);
  });

  it('lets a new login proceed after failed logout without a stale refresh cookie response', async () => {
    const refreshResponse = deferred<Response>();
    const refreshStarted = deferred<void>();
    const operations: string[] = [];
    const fetch = vi.fn(async (path: string) => {
      if (path.endsWith('/csrf')) return json({ headerName: 'X-CSRF-Token', token: 'csrf' });
      operations.push(path);
      if (path.endsWith('/refresh')) {
        refreshStarted.resolve();
        return refreshResponse.promise;
      }
      if (path.endsWith('/logout')) throw new TypeError('Logout disconnected');
      return json({ accessToken: 'new-login', user: { id: 'new-user' } });
    });
    vi.stubGlobal('fetch', fetch);
    const api = await import('../api/auth');
    const refreshing = api.refresh();
    await refreshStarted.promise;
    const logoutFailure = api.logout().catch((error: unknown) => error);
    const login = api.login('b@example.test', 'password');
    expect(operations).toEqual(['/api/v1/auth/refresh']);
    refreshResponse.resolve(json({ accessToken: 'old-refresh', user: { id: 'old-user' } }));
    expect(await refreshing).toBeNull();
    expect(await logoutFailure).toBeInstanceOf(TypeError);
    expect((await login).accessToken).toBe('new-login');
    expect(api.currentSession()?.user.id).toBe('new-user');
    expect(operations).toEqual([
      '/api/v1/auth/refresh',
      '/api/v1/auth/logout',
      '/api/v1/auth/login',
    ]);
  });

  it('clears local authentication on failed logout and renews an invalid refresh CSRF once', async () => {
    let refreshAttempts = 0;
    const fetch = vi.fn(async (path: string) => {
      if (path.endsWith('/csrf')) return json({ headerName: 'X-CSRF-Token', token: 'csrf' });
      if (path.endsWith('/logout')) throw new TypeError('Network unavailable');
      if (path.endsWith('/refresh') && ++refreshAttempts === 1)
        return json({ code: 'CSRF_INVALID', message: 'expired' }, 403);
      return json({ accessToken: 'token', user: { id: 'u' } });
    });
    vi.stubGlobal('fetch', fetch);
    const api = await import('../api/auth');
    expect((await api.refresh())?.accessToken).toBe('token');
    expect(refreshAttempts).toBe(2);
    expect(fetch.mock.calls.filter(([path]) => path.endsWith('/csrf'))).toHaveLength(2);
    await expect(api.logout()).rejects.toThrow('Network unavailable');
    expect(api.currentSession()).toBeNull();
  });
});
