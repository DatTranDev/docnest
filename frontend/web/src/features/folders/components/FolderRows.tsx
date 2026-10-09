'use client';
import { MESSAGE, useI18n } from '@/lib/i18n';
import type { Folder } from '../model/types';
import { Icon } from '@/components/ui/Icon';
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
        <div className="file" key={folder.id}>
          <button className="file-name" onClick={() => onOpen(folder)}>
            <span className="file-type-icon folder-type">
              <Icon name="folder" size={18} />
            </span>
            <span>{folder.name}</span>
          </button>
          <button onClick={() => onRename(folder)}>{t(MESSAGE.rename)}</button>
          <button onClick={() => onMove(folder)}>{t(MESSAGE.move)}</button>
          <button onClick={() => onDelete(folder)}>{t(MESSAGE.delete)}</button>
        </div>
      ))}
    </>
  );
}
