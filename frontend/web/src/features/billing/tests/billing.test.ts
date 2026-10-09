import { describe, expect, it, vi } from 'vitest';
import { billingAttemptKey, hostedBillingUrl } from '../api/billing';

it('retains unacknowledged request keys across retries and isolates accounts/actions', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  try {
    const first = billingAttemptKey('user-one', 'checkout', 'PRO_MONTHLY');
    expect(billingAttemptKey('user-one', 'checkout', 'PRO_MONTHLY').key).toBe(first.key);
    expect(billingAttemptKey('user-two', 'checkout', 'PRO_MONTHLY').key).not.toBe(first.key);
    expect(billingAttemptKey('user-one', 'checkout', 'PRO_YEARLY').key).not.toBe(first.key);
    first.acknowledged();
    expect(billingAttemptKey('user-one', 'checkout', 'PRO_MONTHLY').key).not.toBe(first.key);
  } finally {
    vi.unstubAllGlobals();
  }
});

describe('hosted billing navigation', () => {
  it('allows Stripe hosted Checkout and Portal URLs', () => {
    expect(hostedBillingUrl('https://checkout.stripe.com/c/pay/test')).toBe(
      'https://checkout.stripe.com/c/pay/test',
    );
    expect(hostedBillingUrl('https://billing.stripe.com/p/session/test')).toBe(
      'https://billing.stripe.com/p/session/test',
    );
  });
  it.each([
    'http://checkout.stripe.com/pay',
    'https://checkout.stripe.com.attacker.test/pay',
    'https://user:secret@checkout.stripe.com/pay',
    'javascript:alert(1)',
    'https://billing.stripe.com:8443/pay',
  ])('rejects untrusted destinations %s', (url) => {
    expect(() => hostedBillingUrl(url)).toThrow();
  });
});
