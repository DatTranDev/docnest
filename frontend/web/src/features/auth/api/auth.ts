import { MESSAGE } from '@/lib/i18n/messages';
import { ApiError, configureAuthentication, csrfToken, request, resetCsrf } from '@/lib/http';
import type { Session, User } from '../model/types';
import { publishAccountInitial } from '../model/accountPresentation';
let session: Session | null = null;
let refreshing: Promise<Session | null> | null = null;
let sessionGeneration = 0;
let signingOut = 0;
let cookieMutation: Promise<void> = Promise.resolve();
function mutateSessionCookie<T>(operation: () => Promise<T>): Promise<T> {
  const pending = cookieMutation.then(operation);
  cookieMutation = pending.then(
    () => {},
    () => {},
  );
  return pending;
}
export function currentSession(): Session | null {
  return session;
}
export async function refresh(): Promise<Session | null> {
  if (signingOut) return null;
  if (refreshing) return refreshing;
  const generation = sessionGeneration;
  const pending = mutateSessionCookie(async () => {
    if (generation !== sessionGeneration) return null;
    try {
      resetCsrf();
      const result = await request<Session>('/api/v1/auth/refresh', 'POST');
      if (generation !== sessionGeneration) return null;
      session = result;
      publishAccountInitial(result.user.displayName);
      return session;
    } catch {
      if (generation === sessionGeneration) {
        session = null;
        publishAccountInitial(null);
      }
      return null;
    }
  });
  refreshing = pending;
  void pending.finally(() => {
    if (refreshing === pending) refreshing = null;
  });
  return pending;
}
configureAuthentication({
  accessToken: () => session?.accessToken ?? null,
  refresh: async () => !!(await refresh()),
});
export async function login(email: string, password: string): Promise<Session> {
  const generation = ++sessionGeneration;
  refreshing = null;
  return mutateSessionCookie(async () => {
    if (generation !== sessionGeneration)
      throw new Error(MESSAGE.yourSessionHasChangedPleaseSignInAgain);
    const result = await request<Session>('/api/v1/auth/login', 'POST', { email, password });
    if (generation !== sessionGeneration)
      throw new Error(MESSAGE.yourSessionHasChangedPleaseSignInAgain);
    session = result;
    publishAccountInitial(result.user.displayName);
    return session;
  });
}
export async function loginWithGoogle(credential: string): Promise<Session> {
  const generation = ++sessionGeneration;
  refreshing = null;
  return mutateSessionCookie(async () => {
    if (generation !== sessionGeneration)
      throw new Error(MESSAGE.yourSessionHasChangedPleaseSignInAgain);
    const result = await request<Session>('/api/v1/auth/google', 'POST', { credential });
    if (generation !== sessionGeneration)
      throw new Error(MESSAGE.yourSessionHasChangedPleaseSignInAgain);
    session = result;
    publishAccountInitial(result.user.displayName);
    return session;
  });
}
export async function linkGoogle(
  email: string,
  password: string,
  credential: string,
): Promise<Session> {
  const generation = ++sessionGeneration;
  refreshing = null;
  return mutateSessionCookie(async () => {
    const result = await request<Session>('/api/v1/auth/google/link', 'POST', {
      email,
      password,
      credential,
    });
    if (generation !== sessionGeneration)
      throw new Error(MESSAGE.yourSessionHasChangedPleaseSignInAgain);
    session = result;
    publishAccountInitial(result.user.displayName);
    return result;
  });
}
export async function refreshProfile(): Promise<User> {
  const user = await request<User>('/api/v1/auth/me');
  if (session) session = { ...session, user };
  return user;
}
export type CredentialStatus = { hasPassword: boolean; googleLinked: boolean };
export async function credentialStatus(): Promise<CredentialStatus> {
  return request<CredentialStatus>('/api/v1/auth/methods');
}
export async function uploadAvatar(file: File): Promise<User> {
  if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 1024 * 1024)
    throw new Error('INVALID_AVATAR');
  const send = async (retry: boolean): Promise<void> => {
    const protection = await csrfToken();
    const response = await fetch('/api/v1/auth/me/avatar', {
      method: 'PUT',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${session?.accessToken ?? ''}`,
        [protection.headerName]: protection.token,
        'Content-Type': file.type,
      },
      body: file,
    });
    if (response.status === 401 && retry && (await refresh())) return send(false);
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as { code?: string };
      throw new ApiError(response.status, detail.code ?? 'INVALID_AVATAR', 'Invalid avatar');
    }
  };
  await send(true);
  return refreshProfile();
}
export async function removeAvatar(): Promise<User> {
  await request('/api/v1/auth/me/avatar', 'DELETE');
  return refreshProfile();
}
export async function setupPassword(newPassword: string, googleCredential: string): Promise<void> {
  await request('/api/v1/auth/password/setup', 'POST', { newPassword, googleCredential });
}
export async function unlinkGoogle(currentPassword: string): Promise<void> {
  await request('/api/v1/auth/google/unlink', 'POST', { currentPassword });
}
export async function register(
  email: string,
  password: string,
  displayName: string,
): Promise<void> {
  await request('/api/v1/auth/register', 'POST', { email, password, displayName });
}
export async function logout(): Promise<void> {
  const generation = ++sessionGeneration;
  refreshing = null;
  signingOut++;
  return mutateSessionCookie(async () => {
    try {
      await request('/api/v1/auth/logout', 'POST');
    } finally {
      signingOut--;
      if (generation === sessionGeneration) {
        sessionGeneration++;
        session = null;
        publishAccountInitial(null);
        resetCsrf();
      }
    }
  });
}
