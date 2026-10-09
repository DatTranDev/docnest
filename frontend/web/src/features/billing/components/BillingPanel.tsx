'use client';
import { MESSAGE, useI18n } from '@/lib/i18n';

import { BILLING_TIMING, PAID_PLANS } from '../model/constants';
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/lib/http';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import {
  billingRequest,
  awaitBillingRequest,
  billingAttemptKey,
  hostedBillingUrl,
  plans,
  startBilling,
  subscription,
  type BillingRequest,
  type Plan,
  type Subscription,
} from '../api/billing';

const labels: Record<Plan, string> = {
  FREE: 'Free',
  PRO_MONTHLY: MESSAGE.proMonthly,
  PRO_YEARLY: MESSAGE.proYearly,
};

export function BillingPanel({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { t, localize, localeTag } = useI18n();

  const [account, setAccount] = useState<Subscription | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const live = useRef(true);
  const close = useRef<HTMLButtonElement>(null);
  const journalKey = `billing-request:${userId}`;
  useEffect(() => {
    live.current = true;
    const previous = document.activeElement;
    close.current?.focus();
    const returned = new URL(window.location.href).searchParams.has('billing');
    if (returned) {
      sessionStorage.removeItem(journalKey);
      const url = new URL(window.location.href);
      url.searchParams.delete('billing');
      window.history.replaceState(null, '', url);
    }
    const savedRequest = sessionStorage.getItem(journalKey);
    void plans()
      .then((value) => {
        if (live.current) {
          setEnabled(value.enabled);
          setPending(savedRequest);
        }
      })
      .catch((failure) => {
        if (live.current) setError(errorMessage(failure));
      });
    const load = () => {
      void subscription()
        .then((value) => {
          if (live.current) setAccount(value);
        })
        .catch((failure) => {
          if (live.current) setError(errorMessage(failure));
        });
    };
    load();
    const timer = setInterval(load, BILLING_TIMING.subscriptionPollMs);
    return () => {
      live.current = false;
      clearInterval(timer);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [journalKey]);

  async function follow(initial: BillingRequest) {
    const result = await awaitBillingRequest(initial, () => live.current);
    if (!result || !live.current) return;
    if (result.status === 'SUCCEEDED') {
      if (result.url) window.location.assign(hostedBillingUrl(result.url));
      else {
        sessionStorage.removeItem(journalKey);
        setPending(null);
        setAccount(await subscription());
      }
    } else if (result.status === 'FAILED' || result.status === 'REVIEW') {
      throw new Error(result.errorCode ?? MESSAGE.thePaymentRequestNeedsReview);
    } else throw new Error(MESSAGE.theRequestIsStillProcessingYouCanResume);
  }
  async function action(kind: 'checkout' | 'portal' | 'cancel' | 'reconcile', plan?: Plan) {
    setBusy(true);
    setError('');
    try {
      const attempt = billingAttemptKey(journalKey, kind, plan);
      const result = await startBilling(kind, plan, attempt.key);
      attempt.acknowledged();
      sessionStorage.setItem(journalKey, result.id);
      if (live.current) setPending(result.id);
      await follow(result);
    } catch (failure) {
      if (live.current) setError(errorMessage(failure));
    } finally {
      if (live.current) setBusy(false);
    }
  }
  async function resume() {
    if (!pending) return;
    setBusy(true);
    setError('');
    try {
      await follow(await billingRequest(pending));
    } catch (failure) {
      if (live.current) setError(errorMessage(failure));
    } finally {
      if (live.current) setBusy(false);
    }
  }
  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label={t(MESSAGE.subscriptionPlans)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
        if (event.key === 'Tab') {
          const buttons = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
          );
          const first = buttons[0],
            last = buttons[buttons.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <div className="panel billing-panel">
        <div className="billing-heading">
          <h2>{t(MESSAGE.subscriptionPlans)}</h2>
          <button ref={close} onClick={onClose} aria-label={t(MESSAGE.closeSubscriptionPlans)}>
            {t(MESSAGE.close)}{' '}
          </button>
        </div>
        <ErrorNotice message={error} />
        <p>
          {t(MESSAGE.currentPlan)}{' '}
          <strong>{account ? localize(labels[account.plan]) : t(MESSAGE.loading)}</strong>
        </p>
        {account?.expiresAt && (
          <p>
            {t(MESSAGE.paidThrough)} {new Date(account.expiresAt).toLocaleString(localeTag)}
          </p>
        )}
        {account?.cancelAtPeriodEnd && <p>{t(MESSAGE.renewalWillStopAtTheEndOfThe)}</p>}
        {account && ['PROVISIONING', 'COMPENSATING', 'MANUAL_REVIEW'].includes(account.state) && (
          <p role="status">
            {account.state === 'MANUAL_REVIEW'
              ? t(MESSAGE.yourSubscriptionNeedsReviewBeforeItCanBe)
              : t(MESSAGE.updatingSubscription)}
          </p>
        )}
        <p>{t(MESSAGE.stripeHandlesPaymentsPricesAndBillingPeriodsAppear)} </p>
        {!enabled && (
          <p role="status">{t(MESSAGE.testPaymentsAreNotConfiguredExistingFeaturesRemain)} </p>
        )}
        <div className="billing-options">
          {PAID_PLANS.map((plan) => (
            <div className="billing-option" key={plan}>
              <strong>{localize(labels[plan])}</strong>
              <p>{t(MESSAGE.manageSubscriptionsAndRenewalsOnStripe)}</p>
              <button
                disabled={!enabled || busy || account?.plan !== 'FREE'}
                onClick={() => {
                  void action('checkout', plan);
                }}
              >
                {t(MESSAGE.viewPricingAndSubscribe)}{' '}
              </button>
            </div>
          ))}
        </div>
        <div className="billing-actions">
          <button
            disabled={!enabled || busy}
            onClick={() => {
              void action('portal');
            }}
          >
            {t(MESSAGE.manageOnStripe)}{' '}
          </button>
          <button
            disabled={!enabled || busy || account?.plan === 'FREE' || account?.cancelAtPeriodEnd}
            onClick={() => {
              void action('cancel');
            }}
          >
            {t(MESSAGE.cancelRenewal)}{' '}
          </button>
          <button
            disabled={!enabled || busy}
            onClick={() => {
              void action('reconcile');
            }}
          >
            {t(MESSAGE.refreshSubscription)}{' '}
          </button>
          {pending && (
            <button
              disabled={busy}
              onClick={() => {
                void resume();
              }}
            >
              {t(MESSAGE.resumeRequest)}{' '}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
