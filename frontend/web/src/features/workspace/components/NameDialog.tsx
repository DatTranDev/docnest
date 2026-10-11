'use client';
import { useState } from 'react';
import { ModalDialog } from '@/components/ui/ModalDialog';
import { MESSAGE, useI18n } from '@/lib/i18n';
import { errorMessage } from '@/lib/http';

export function NameDialog({
  title,
  initial,
  onSubmit,
  onClose,
}: {
  title: string;
  initial: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t, errorText } = useI18n();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <ModalDialog title={title} onClose={onClose} className="name-dialog">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          void onSubmit(name.trim())
            .then(onClose)
            .catch((failure) => setError(errorText(errorMessage(failure))))
            .finally(() => setBusy(false));
        }}
      >
        <h2>{title}</h2>
        <label>
          {t(MESSAGE.itemName)}
          <input
            autoFocus
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            {t(MESSAGE.cancel)}
          </button>
          <button className="primary" disabled={busy || !name.trim()}>
            {busy ? t(MESSAGE.processing) : title}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
