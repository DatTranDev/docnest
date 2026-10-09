'use client';
import { MESSAGE, useI18n } from '@/lib/i18n';

import { ErrorNotice } from '@/components/ui/ErrorNotice';
export default function ErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();

  return (
    <main>
      <ErrorNotice message={MESSAGE.unableToOpenThePageDraftsOnThis} />
      <button onClick={reset}>{t(MESSAGE.tryAgain)}</button>
    </main>
  );
}
