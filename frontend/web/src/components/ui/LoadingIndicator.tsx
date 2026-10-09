'use client';
import { MESSAGE, useI18n } from '@/lib/i18n';
export function LoadingIndicator({ message = MESSAGE.restoringSession }: { message?: string }) {
  const { localize } = useI18n();
  return (
    <div className="loading" role="status">
      {localize(message)}
    </div>
  );
}
