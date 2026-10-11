'use client';
import { MESSAGE, useI18n } from '@/lib/i18n';
import type { Version } from '../model/types';
import { ModalDialog } from '@/components/ui/ModalDialog';
export function VersionDialog({
  versions,
  activeRevision,
  onOpen,
  onBack,
  onCopy,
  onClose,
}: {
  versions: Version[];
  activeRevision?: number;
  onOpen: (revision: number) => void;
  onBack?: () => void;
  onCopy?: () => void;
  onClose: () => void;
}) {
  const { t, localeTag } = useI18n();

  return (
    <ModalDialog title={t(MESSAGE.versionHistory)} onClose={onClose} className="version-dialog">
      <div className="version-drawer-heading">
        <h2>{t(MESSAGE.versionHistory)}</h2>
        <button aria-label={t(MESSAGE.close)} onClick={onClose}>
          ×
        </button>
      </div>
      {onCopy && (
        <button
          className="primary version-copy"
          disabled={activeRevision === undefined}
          onClick={onCopy}
        >
          {t(MESSAGE.saveAsNewDocument)}
        </button>
      )}
      {onBack && (
        <button className="version-back" onClick={onBack}>
          {t(MESSAGE.backToCurrent)}
        </button>
      )}
      <ol className="version-timeline">
        {versions.map((version) => (
          <li className={activeRevision === version.revision ? 'selected' : ''} key={version.id}>
            <button onClick={() => onOpen(version.revision)}>
              <strong>
                {t(MESSAGE.version)} {version.revision}
              </strong>
              <span>{new Date(version.createdAt).toLocaleString(localeTag)}</span>
              <small>{t(MESSAGE.openReadOnly)}</small>
            </button>
          </li>
        ))}
      </ol>
    </ModalDialog>
  );
}
