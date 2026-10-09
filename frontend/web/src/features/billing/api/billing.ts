import { MESSAGE } from '@/lib/i18n/messages';
import { BILLING_TIMING, STRIPE_HOSTED_DOMAINS } from '../model/constants';
import { request } from '@/lib/http';

export type Plan = 'FREE' | 'PRO_MONTHLY' | 'PRO_YEARLY';
export type Subscription = {
  plan: Plan;
  state: string;
  stripeStatus: string;
  expiresAt: string | null;
  cancelAtPeriodEnd: boolean;
  sagaId: string | null;
};
export type BillingRequest = {
  id: string;
  kind: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'REVIEW';
  url: string | null;
  errorCode: string | null;
  expiresAt: string;
};
export const plans = () =>
  request<{ enabled: boolean; testMode: boolean; plans: Plan[] }>('/api/v1/billing/plans');
export const subscription = () => request<Subscription>('/api/v1/billing/subscription');
export const billingRequest = (id: string) =>
  request<BillingRequest>(`/api/v1/billing/requests/${encodeURIComponent(id)}`);
export const startBilling = (
  action: 'checkout' | 'portal' | 'cancel' | 'reconcile',
  plan?: Plan,
  idempotencyKey = crypto.randomUUID(),
) =>
  request<BillingRequest>(`/api/v1/billing/${action}`, 'POST', plan ? { plan } : undefined, {
    'Idempotency-Key': idempotencyKey,
  });

// Called only from client event handlers. Keep a key until the server acknowledges
// the request so a lost response/reload cannot create a second billing operation.
export function billingAttemptKey(journal: string, action: string, plan?: Plan) {
  const storageKey = `${journal}:attempt:${action}:${plan ?? 'FREE'}`;
  const saved = sessionStorage.getItem(storageKey);
  const key =
    saved && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(saved)
      ? saved
      : crypto.randomUUID();
  sessionStorage.setItem(storageKey, key);
  return { key, acknowledged: () => sessionStorage.removeItem(storageKey) };
}

export async function awaitBillingRequest(initial: BillingRequest, active: () => boolean) {
  let result = initial;
  const deadline = Date.now() + BILLING_TIMING.requestWaitMs;
  while (active() && ['PENDING', 'RUNNING'].includes(result.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, BILLING_TIMING.requestPollMs));
    if (!active()) return null;
    result = await billingRequest(result.id);
  }
  return active() ? result : null;
}

export function hostedBillingUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    !STRIPE_HOSTED_DOMAINS.some((host) => host === url.hostname) ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  )
    throw new Error(MESSAGE.invalidPaymentAddress);
  return url.href;
}
