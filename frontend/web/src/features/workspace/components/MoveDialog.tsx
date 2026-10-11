'use client';
import { MESSAGE, useI18n } from '@/lib/i18n';
import { useState } from 'react';
import { ModalDialog } from '@/components/ui/ModalDialog';
import { OptionSelect } from '@/components/ui/OptionSelect';
import { errorMessage } from '@/lib/http';
import type { Folder } from '@/features/folders';
import type { MoveTarget } from '../model/types';
export function MoveDialog({
  destination,
  folders,
  onMove,
  onClose,
}: {
  destination: MoveTarget;
  folders: Folder[];
  onMove: (target: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const { t, errorText } = useI18n();

  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path = (folder: Folder) => {
    const names = [folder.name];
    let parent = folder.parentId ? byId.get(folder.parentId) : undefined;
    while (parent) {
      names.unshift(parent.name);
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    return names.join(' / ');
  };
  const invalidDestination = (folder: Folder) => {
    if (destination.kind !== 'folder') return false;
    let current: Folder | undefined = folder;
    while (current) {
      if (current.id === destination.item.id) return true;
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return false;
  };
  return (
    <ModalDialog title={t(MESSAGE.move)} onClose={onClose} className="move-dialog">
      <h2>{t(MESSAGE.move)}</h2>
      <div className="move-destination-field">
        <span>{t(MESSAGE.destinationFolder)}</span>
        <OptionSelect
          label={t(MESSAGE.destinationFolder)}
          value={target}
          disabled={busy}
          inlineMenu
          onChange={setTarget}
          options={[
            { value: '', label: t(MESSAGE.myDocuments) },
            ...folders
              .filter((folder) => !invalidDestination(folder))
              .map((folder) => ({ value: folder.id, label: path(folder) })),
          ]}
        />
      </div>
      {error && (
        <p className="dialog-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button disabled={busy} onClick={onClose}>
          {t(MESSAGE.cancel)}
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError('');
            void onMove(target || null)
              .then(onClose)
              .catch((failure) => setError(errorText(errorMessage(failure))))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? t(MESSAGE.processing) : t(MESSAGE.move)}
        </button>
      </div>
    </ModalDialog>
  );
}
