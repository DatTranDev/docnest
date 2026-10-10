'use client';
import { MESSAGE, useI18n } from '@/lib/i18n';
import { DocumentPreview } from './DocumentPreview';
import { Icon } from '@/components/ui/Icon';
import { ActionMenu, type MenuAction } from '@/components/ui/ActionMenu';
import { roleLabel } from '@/components/ui/roleLabel';
import type { DocumentInfo } from '../model/types';
import { sourceFileType } from '../model/sourceFiles';
export function DocumentRows({
  documents,
  trash,
  view = 'list',
  onOpen,
  onRename,
  onMove,
  onTrash,
  onRestore,
}: {
  documents: DocumentInfo[];
  trash: boolean;
  view?: 'grid' | 'list';
  onOpen: (document: DocumentInfo) => void;
  onRename: (document: DocumentInfo) => void;
  onMove: (document: DocumentInfo) => void;
  onTrash: (document: DocumentInfo) => void;
  onRestore: (document: DocumentInfo) => void;
}) {
  const { t, localize, countLabel } = useI18n();

  return (
    <>
      {documents.map((document) => {
        const actions: MenuAction[] = trash
          ? []
          : [
              {
                label: t(MESSAGE.openDocument),
                icon: 'document',
                onSelect: () => onOpen(document),
              },
            ];
        if (document.effectiveRole === 'OWNER') {
          if (trash)
            actions.push({
              label: t(MESSAGE.restore),
              icon: 'restore',
              onSelect: () => onRestore(document),
            });
          else
            actions.push(
              { label: t(MESSAGE.rename), icon: 'edit', onSelect: () => onRename(document) },
              { label: t(MESSAGE.move), icon: 'move', onSelect: () => onMove(document) },
              {
                label: t(MESSAGE.moveToTrash),
                icon: 'trash',
                danger: true,
                onSelect: () => onTrash(document),
              },
            );
        }
        return (
          <article
            className="file document-file"
            key={document.id}
            data-document-id={document.id}
            aria-label={document.title}
          >
            <button className="file-name" disabled={trash} onClick={() => onOpen(document)}>
              <span className="file-type-icon document-type">
                <Icon name="document" size={18} />
              </span>
              <span className="file-label">
                <span title={document.title}>{document.title}</span>
                {view === 'list' && <DocumentPreview document={document} />}
              </span>
            </button>
            <span className="file-kind">
              {
                {
                  markdown: 'Markdown',
                  json: 'JSON',
                  code: 'Code',
                  document: t(MESSAGE.documentType),
                }[sourceFileType(document.title) ?? 'document']
              }
            </span>
            <span className="file-access">{localize(roleLabel(document.effectiveRole))}</span>
            <ActionMenu
              label={t(MESSAGE.actionsForValue, { p0: document.title })}
              actions={actions}
            />
            {view === 'grid' && (
              <>
                <button
                  className="document-cover"
                  disabled={trash}
                  aria-label={t(MESSAGE.openValue, { p0: document.title })}
                  onClick={() => onOpen(document)}
                >
                  <DocumentPreview document={document} paper />
                </button>
                <div className="document-card-footer">
                  <span>{localize(roleLabel(document.effectiveRole))}</span>
                  {typeof document.preview?.wordCount === 'number' && (
                    <span>{countLabel(document.preview.wordCount, 'words')}</span>
                  )}
                </div>
              </>
            )}
          </article>
        );
      })}
    </>
  );
}
