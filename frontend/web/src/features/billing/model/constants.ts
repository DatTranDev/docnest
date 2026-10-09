export const BILLING_TIMING = {
  subscriptionPollMs: 2500,
  requestPollMs: 500,
  requestWaitMs: 30000,
} as const;
export const STRIPE_HOSTED_DOMAINS = ['checkout.stripe.com', 'billing.stripe.com'] as const;
export const PAID_PLANS = ['PRO_MONTHLY', 'PRO_YEARLY'] as const;
