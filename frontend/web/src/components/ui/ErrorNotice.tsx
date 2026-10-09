'use client';
import { MESSAGE, useI18n } from '@/lib/i18n';
export function ErrorNotice({ message, onClose }: { message: string; onClose?: () => void }) {
  const { t, errorText } = useI18n();

  if (!message) return null;
  return (
    <div role="alert" className="error">
      {errorText(message)}
      {onClose && (
        <button aria-label={t(MESSAGE.dismissError)} onClick={onClose}>
          ×
        </button>
      )}
    </div>
  );
}
