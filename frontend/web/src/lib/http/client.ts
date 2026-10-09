import { MESSAGE } from '@/lib/i18n/messages';
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
type CsrfToken = { headerName: string; token: string };
type AuthPort = { accessToken: () => string | null; refresh: () => Promise<boolean> };
let authentication: AuthPort = { accessToken: () => null, refresh: async () => false };
let csrf: CsrfToken | null = null;
let csrfPending: Promise<CsrfToken> | null = null;
let csrfGeneration = 0;
export function configureAuthentication(port: AuthPort): void {
  authentication = port;
}
export function resetCsrf(): void {
  csrf = null;
  csrfGeneration++;
}
export async function csrfToken(): Promise<CsrfToken> {
  if (csrf) return csrf;
  if (csrfPending) return csrfPending;
  const generation = csrfGeneration;
  const pending = (async () => {
    const response = await fetch('/api/v1/auth/csrf', {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(MESSAGE.unableToObtainSessionProtectionPleaseTryAgain);
    const token = (await response.json()) as CsrfToken;
    if (generation === csrfGeneration) csrf = token;
    return token;
  })();
  csrfPending = pending;
  try {
    return await pending;
  } finally {
    if (csrfPending === pending) csrfPending = null;
  }
}
export async function request<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
  retry = true,
): Promise<T> {
  const auth = path.startsWith('/api/v1/auth/');
  const outgoing: Record<string, string> = { ...headers };
  const token = authentication.accessToken();
  if (token) outgoing.Authorization = `Bearer ${token}`;
  if (body !== undefined) outgoing['Content-Type'] = 'application/json';
  if (auth && method !== 'GET') {
    const protection = await csrfToken();
    outgoing[protection.headerName] = protection.token;
  }
  const response = await fetch(path, {
    method,
    credentials: 'include',
    cache: 'no-store',
    headers: outgoing,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 401 && !auth && retry && (await authentication.refresh()))
    return request(path, method, body, headers, false);
  if (!response.ok) {
    const error = (await response.json().catch(() => ({
      code: 'NETWORK_ERROR',
      message: MESSAGE.theRequestFailedPleaseTryAgain,
    }))) as {
      code: string;
      message: string;
      details?: Record<string, unknown>;
    };
    if (auth && response.status === 403 && error.code === 'CSRF_INVALID' && retry) {
      resetCsrf();
      return request(path, method, body, headers, false);
    }
    throw new ApiError(response.status, error.code, error.message, error.details);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export async function bytes(
  path: string,
  options: RequestInit = {},
  authenticated = true,
  retry = true,
): Promise<Uint8Array> {
  const headers = new Headers(options.headers),
    token = authentication.accessToken();
  if (authenticated && token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(path, {
    ...options,
    headers,
    cache: 'no-store',
    credentials: authenticated ? 'include' : 'omit',
  });
  if (response.status === 401 && authenticated && retry && (await authentication.refresh()))
    return bytes(path, options, authenticated, false);
  if (!response.ok)
    throw new ApiError(response.status, 'DOWNLOAD_FAILED', MESSAGE.unableToDownloadContent);
  return new Uint8Array(await response.arrayBuffer());
}
export async function binaryRequest<T>(
  path: string,
  payload: Uint8Array,
  retry = true,
): Promise<T> {
  const token = authentication.accessToken();
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'omit',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/octet-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: new Blob([payload as Uint8Array<ArrayBuffer>]),
  });
  if (response.status === 401 && retry && (await authentication.refresh()))
    return binaryRequest(path, payload, false);
  if (!response.ok) {
    const error = (await response.json().catch(() => ({ code: 'COLLABORATION_UNAVAILABLE' }))) as {
      code: string;
    };
    throw new ApiError(response.status, error.code, error.code);
  }
  return response.json() as Promise<T>;
}
export function download(data: Uint8Array, name: string, type = 'application/octet-stream'): void {
  const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.code
    : error instanceof Error
      ? error.message
      : MESSAGE.somethingWentWrongPleaseTryAgain;
}
