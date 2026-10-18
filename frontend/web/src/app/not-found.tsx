'use client';
import { MESSAGE, useI18n } from '@/lib/i18n';
import Link from 'next/link';

export default function NotFound() {
  const { t } = useI18n();

  return (
    <main className="public-state-page">
      <section className="public-state-card">
        <span className="public-state-brand">docsnest</span>
        <h1>{t(MESSAGE.pageNotFound)}</h1>
        <div className="public-state-actions">
          <Link className="primary" href="/intro">
            {t(MESSAGE.introduction)}
          </Link>
          <Link href="/">{t(MESSAGE.goToDocuments)}</Link>
        </div>
      </section>
    </main>
  );
}
