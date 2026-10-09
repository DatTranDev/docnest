'use client';
import { MESSAGE, useI18n } from '@/lib/i18n';
import { DocumentPreview } from './DocumentPreview';
import { Icon } from '@/components/ui/Icon';
import { roleLabel } from '@/components/ui/roleLabel';
import type { DocumentInfo } from '../model/types';
export function DocumentRows({
  documents,
  trash,
  onOpen,
  onRename,
  onMove,
  onTrash,
  onRestore,
}: {
  documents: DocumentInfo[];
  trash: boolean;
  onOpen: (document: DocumentInfo) => void;
  onRename: (document: DocumentInfo) => void;
  onMove: (document: DocumentInfo) => void;
  onTrash: (document: DocumentInfo) => void;
  onRestore: (document: DocumentInfo) => void;
}) {
  const { t, localize } = useI18n();

  return (
    <>
      {documents.map((document) => (
        <div className="file" key={document.id}>
          <button className="file-name" disabled={trash} onClick={() => onOpen(document)}>
            <span className="file-type-icon document-type">
              <Icon name="document" size={18} />
            </span>
            <span>{document.title}</span>
          </button>
          <span className="badge">{localize(roleLabel(document.effectiveRole))}</span>
          <DocumentPreview document={document} />
          {document.effectiveRole === 'OWNER' &&
            (trash ? (
              <button onClick={() => onRestore(document)}>{t(MESSAGE.restore)}</button>
            ) : (
              <>
                <button onClick={() => onRename(document)}>{t(MESSAGE.rename)}</button>
                <button onClick={() => onMove(document)}>{t(MESSAGE.move)}</button>
                <button onClick={() => onTrash(document)}>{t(MESSAGE.moveToTrash)}</button>
              </>
            ))}
        </div>
      ))}
    </>
  );
}
