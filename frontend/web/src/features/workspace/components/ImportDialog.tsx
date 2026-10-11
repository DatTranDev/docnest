'use client';
import { useState } from 'react';
import { ModalDialog } from '@/components/ui/ModalDialog';
import { MESSAGE, useI18n } from '@/lib/i18n';
import { errorMessage } from '@/lib/http';

export function ImportDialog({
  onImport,
  onClose,
}: {
  onImport: (file: File) => Promise<void>;
  onClose: () => void;
}) {
  const { t, errorText } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <ModalDialog title={t(MESSAGE.importFile)} onClose={onClose} className="import-dialog">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!file) return;
          setBusy(true);
          setError('');
          void onImport(file)
            .then(onClose)
            .catch((failure) => setError(errorText(errorMessage(failure))))
            .finally(() => setBusy(false));
        }}
      >
        <h2>{t(MESSAGE.importFile)}</h2>
        <p>{t(MESSAGE.importNewDocumentHint)}</p>
        <label>
          {t(MESSAGE.chooseFile)}
          <input
            autoFocus
            type="file"
            accept=".txt,.tedoc,.docx,.md,.markdown,.json,.js,.ts,.jsx,.tsx,.py,.html,.css"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        {file && <p className="import-filename">{file.name}</p>}
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            {t(MESSAGE.cancel)}
          </button>
          <button className="primary" disabled={busy || !file}>
            {busy ? t(MESSAGE.processing) : t(MESSAGE.importFile)}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
