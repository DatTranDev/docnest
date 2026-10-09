'use client';
import { MESSAGE, useI18n } from '@/lib/i18n';
import { useState } from 'react';
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
  onMove: (target: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();

  const [target, setTarget] = useState('');
  return (
    <div className="modal" role="dialog" aria-label={t(MESSAGE.move)}>
      <div className="panel">
        <h2>{t(MESSAGE.move)}</h2>
        <select
          aria-label={t(MESSAGE.destinationFolder)}
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        >
          <option value="">{t(MESSAGE.root)}</option>
          {folders
            .filter((folder) => destination.kind !== 'folder' || folder.id !== destination.item.id)
            .map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
        </select>
        <button onClick={() => onMove(target || null)}>{t(MESSAGE.move)}</button>
        <button onClick={onClose}>{t(MESSAGE.cancel)}</button>
      </div>
    </div>
  );
}
