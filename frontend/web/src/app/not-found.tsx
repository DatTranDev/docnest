'use client';
import { MESSAGE, useI18n } from '@/lib/i18n';
import Link from 'next/link';

export default function NotFound() {
  const { t } = useI18n();

  return (
    <main>
      <h1>{t(MESSAGE.pageNotFound)}</h1>
      <Link href="/">{t(MESSAGE.goToDocuments)}</Link>
    </main>
  );
}
