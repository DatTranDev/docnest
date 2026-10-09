'use client';
import { MESSAGE, useI18n } from '@/lib/i18n';
import type { Version } from '../model/types';
export function VersionDialog({
  versions,
  onOpen,
  onClose,
}: {
  versions: Version[];
  onOpen: (revision: number) => void;
  onClose: () => void;
}) {
  const { t, localeTag } = useI18n();

  return (
    <div className="modal" role="dialog" aria-label={t(MESSAGE.versionHistory)}>
      <div className="panel">
        <h2>{t(MESSAGE.versionHistory)}</h2>
        {versions.map((version) => (
          <div className="row" key={version.id}>
            {t(MESSAGE.version)} {version.revision} ·{' '}
            {new Date(version.createdAt).toLocaleString(localeTag)}
            <button onClick={() => onOpen(version.revision)}>{t(MESSAGE.openReadOnly)}</button>
          </div>
        ))}
        <button onClick={onClose}>{t(MESSAGE.close)}</button>
      </div>
    </div>
  );
}
