'use client';
import { MESSAGE, useI18n } from '@/lib/i18n';

import { ErrorNotice } from '@/components/ui/ErrorNotice';
import Link from 'next/link';
export default function ErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();

  return (
    <main className="public-state-page">
      <section className="public-state-card">
        <span className="public-state-brand">docsnest</span>
        <ErrorNotice message={MESSAGE.unableToOpenThePageDraftsOnThis} />
        <div className="public-state-actions">
          <button className="primary" onClick={reset}>
            {t(MESSAGE.tryAgain)}
          </button>
          <Link href="/intro">{t(MESSAGE.introduction)}</Link>
          <Link href="/">{t(MESSAGE.goToDocuments)}</Link>
        </div>
      </section>
    </main>
  );
}
