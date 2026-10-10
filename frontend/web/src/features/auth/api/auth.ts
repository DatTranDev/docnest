import { MESSAGE } from '@/lib/i18n/messages';
import { configureAuthentication, request, resetCsrf } from '@/lib/http';
import type { Session } from '../model/types';
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
