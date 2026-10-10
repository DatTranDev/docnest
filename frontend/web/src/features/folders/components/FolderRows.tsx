'use client';
import { MESSAGE, useI18n } from '@/lib/i18n';
import type { Folder } from '../model/types';
import { Icon } from '@/components/ui/Icon';
import { ActionMenu } from '@/components/ui/ActionMenu';
export function FolderRows({
  folders,
  onOpen,
  onRename,
  onMove,
  onDelete,
}: {
  folders: Folder[];
  onOpen: (folder: Folder) => void;
  onRename: (folder: Folder) => void;
  onMove: (folder: Folder) => void;
  onDelete: (folder: Folder) => void;
}) {
  const { t } = useI18n();

  return (
    <>
      {folders.map((folder) => (
        <article className="file folder-file" key={folder.id} aria-label={folder.name}>
          <button className="file-name" onClick={() => onOpen(folder)}>
            <span className="file-type-icon folder-type">
              <Icon name="folder" size={18} />
            </span>
            <span className="file-label" title={folder.name}>
              {folder.name}
            </span>
          </button>
          <span className="file-kind">{t(MESSAGE.folderType)}</span>
          <span className="file-access">{t(MESSAGE.owner)}</span>
          <ActionMenu
            label={t(MESSAGE.actionsForValue, { p0: folder.name })}
            actions={[
              { label: t(MESSAGE.openFolder), icon: 'folder', onSelect: () => onOpen(folder) },
              { label: t(MESSAGE.rename), icon: 'edit', onSelect: () => onRename(folder) },
              { label: t(MESSAGE.move), icon: 'move', onSelect: () => onMove(folder) },
              {
                label: t(MESSAGE.delete),
                icon: 'trash',
                danger: true,
                onSelect: () => onDelete(folder),
              },
            ]}
          />
        </article>
      ))}
    </>
  );
}
