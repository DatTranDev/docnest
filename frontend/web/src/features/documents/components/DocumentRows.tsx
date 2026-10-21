'use client';
import { useEffect, useMemo, useState } from 'react';
import { MESSAGE, useI18n } from '@/lib/i18n';
import { Avatar } from '@/components/ui/Avatar';
import { DocumentPreview } from './DocumentPreview';
import { Icon } from '@/components/ui/Icon';
import { ActionMenu, type MenuAction } from '@/components/ui/ActionMenu';
import { roleLabel } from '@/components/ui/roleLabel';
import type { DocumentInfo } from '../model/types';
import { sourceFileType } from '../model/sourceFiles';
import { publicProfile, type PublicProfile } from '../api/publicProfiles';
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
  const { t, localize, countLabel, localeTag } = useI18n();
  const [owners, setOwners] = useState<Record<string, PublicProfile>>({});
  const ownerIds = useMemo(
    () => [
      ...new Set(
        documents.filter((item) => item.effectiveRole !== 'OWNER').map((item) => item.ownerUserId),
      ),
    ],
    [documents],
  );
  useEffect(() => {
    let active = true;
    void Promise.all(
      ownerIds.map(async (id) => {
        try {
          return [id, await publicProfile(id)] as const;
        } catch {
          return null;
        }
      }),
    ).then((pairs) => {
      if (active) setOwners(Object.fromEntries(pairs.filter((pair) => pair !== null)));
    });
    return () => {
      active = false;
    };
  }, [ownerIds]);

  return (
    <>
      {documents.map((document) => {
        const kind = sourceFileType(document.title) ?? 'document';
        const owner = document.effectiveRole === 'OWNER' ? undefined : owners[document.ownerUserId];
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
            className={`file document-file${trash ? ' trash-file' : ''}`}
            key={document.id}
            data-document-id={document.id}
            aria-label={document.title}
          >
            <button className="file-name" disabled={trash} onClick={() => onOpen(document)}>
              <span className={`file-type-icon document-type document-type-${kind}`}>
                <Icon name="document" size={18} />
              </span>
              <span className="file-label">
                <span title={document.title}>{document.title}</span>
                {view === 'list' && <DocumentPreview document={document} />}
                {view === 'list' && (
                  <span className="mobile-file-access">
                    {localize(roleLabel(document.effectiveRole))}
                  </span>
                )}
              </span>
            </button>
            <span className="file-metadata">
              <span className="file-created">
                {document.createdAt && !Number.isNaN(Date.parse(document.createdAt)) ? (
                  <time
                    dateTime={document.createdAt}
                    title={new Date(document.createdAt).toLocaleString(localeTag)}
                  >
                    {new Date(document.createdAt).toLocaleDateString(localeTag, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </time>
                ) : (
                  '—'
                )}
              </span>
              <span className="file-size">
                {typeof document.sizeBytes === 'number'
                  ? `${new Intl.NumberFormat(localeTag, { maximumFractionDigits: 1 }).format(document.sizeBytes / 1024)} KB`
                  : '—'}
              </span>
              <span className={`file-kind file-kind-${kind}`}>
                {
                  {
                    markdown: 'Markdown',
                    json: 'JSON',
                    code: 'Code',
                    document: t(MESSAGE.documentType),
                  }[kind]
                }
              </span>
              <span className="file-access">
                {owner && <Avatar name={owner.displayName} src={owner.avatarUrl} size={23} />}
                {localize(roleLabel(document.effectiveRole))}
              </span>
            </span>
            {trash && view === 'list' ? (
              <button className="restore-row-button" onClick={() => onRestore(document)}>
                {t(MESSAGE.restore)}
              </button>
            ) : (
              <ActionMenu
                label={t(MESSAGE.actionsForValue, { p0: document.title })}
                actions={actions}
              />
            )}
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
                  <span className="document-owner-meta">
                    {owner && <Avatar name={owner.displayName} src={owner.avatarUrl} size={23} />}
                    {localize(roleLabel(document.effectiveRole))}
                  </span>
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
