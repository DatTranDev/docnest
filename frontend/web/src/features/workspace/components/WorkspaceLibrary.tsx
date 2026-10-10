'use client';
import { useMemo, useState, type ComponentProps } from 'react';
import { DocumentRows, sourceFileType, type DocumentInfo } from '@/features/documents';
import { FolderRows, type Folder } from '@/features/folders';
import { Icon } from '@/components/ui/Icon';
import { MESSAGE, useI18n } from '@/lib/i18n';
import type { Scope } from '../model/types';
import { useLibraryView } from '../hooks/useLibraryView';

export function WorkspaceLibrary({
  scope,
  path,
  folders,
  documents,
  query,
  loading,
  hasMore,
  onLoadMore,
  onPath,
  onClearSearch,
  onReturnToEditor,
  folderActions,
  documentActions,
}: {
  scope: Scope;
  path: Folder[];
  folders: Folder[];
  documents: DocumentInfo[];
  query: string;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onPath: (path: Folder[]) => void;
  onClearSearch: () => void;
  onReturnToEditor?: () => void;
  folderActions: Omit<ComponentProps<typeof FolderRows>, 'folders'>;
  documentActions: Omit<ComponentProps<typeof DocumentRows>, 'documents' | 'trash' | 'view'>;
}) {
  const { t, localeTag } = useI18n();
  const [view, setView] = useLibraryView();
  const [kind, setKind] = useState('all');
  const [descending, setDescending] = useState(false);
  const items = useMemo(() => {
    const collator = new Intl.Collator(localeTag, { numeric: true, sensitivity: 'base' });
    const direction = descending ? -1 : 1;
    return {
      folders:
        kind !== 'all' && kind !== 'folders'
          ? []
          : [...folders].sort((a, b) => direction * collator.compare(a.name, b.name)),
      documents:
        kind === 'folders'
          ? []
          : [...documents]
              .filter(
                (document) =>
                  ['all', 'documents'].includes(kind) || sourceFileType(document.title) === kind,
              )
              .sort((a, b) => direction * collator.compare(a.title, b.title)),
    };
  }, [folders, documents, kind, descending, localeTag]);
  const title =
    scope === 'mine'
      ? MESSAGE.myDocuments
      : scope === 'shared'
        ? MESSAGE.sharedWithMe
        : MESSAGE.trash;
  const empty = !items.folders.length && !items.documents.length;
  return (
    <section className={`workspace library-${view}`} aria-label={t(title)}>
      <div className="workspace-heading">
        {scope === 'mine' && path.length ? (
          <nav className="workspace-breadcrumb" aria-label={t(MESSAGE.breadcrumb)}>
            <button onClick={() => onPath([])}>{t(MESSAGE.myDocuments)}</button>
            {path.map((folder, index) => (
              <span key={folder.id}>
                <Icon name="chevron" size={18} />
                <button
                  aria-current={index === path.length - 1 ? 'page' : undefined}
                  onClick={() => onPath(path.slice(0, index + 1))}
                >
                  {folder.name}
                </button>
              </span>
            ))}
          </nav>
        ) : (
          <h1>{t(title)}</h1>
        )}
        <div className="workspace-heading-actions">
          {onReturnToEditor && (
            <button className="return-editor" onClick={onReturnToEditor}>
              {t(MESSAGE.returnToEditor)}
            </button>
          )}
          <div className="view-switch" role="group" aria-label={t(MESSAGE.viewLayout)}>
            {(['list', 'grid'] as const).map((layout) => (
              <button
                key={layout}
                aria-label={t(layout === 'grid' ? MESSAGE.gridView : MESSAGE.listView)}
                title={t(layout === 'grid' ? MESSAGE.gridView : MESSAGE.listView)}
                aria-pressed={view === layout}
                onClick={() => setView(layout)}
              >
                <Icon name={layout} size={19} />
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="workspace-toolbar">
        <label className="type-filter">
          <span>{t(MESSAGE.typeFilter)}</span>
          <select
            aria-label={t(MESSAGE.typeFilter)}
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="all">{t(MESSAGE.allItems)}</option>
            <option value="folders">{t(MESSAGE.folderPlural)}</option>
            <option value="documents">{t(MESSAGE.documents)}</option>
            <option value="markdown">Markdown</option>
            <option value="json">JSON</option>
            <option value="code">Code</option>
          </select>
        </label>
        {query && (
          <button className="search-chip" onClick={onClearSearch}>
            <span>{query}</span>
            <Icon name="close" size={15} />
          </button>
        )}
        <span className="library-count">
          {t(MESSAGE.itemsShown, { p0: items.folders.length + items.documents.length })}
        </span>
      </div>
      <div className="library-columns">
        <button
          className="name-sort"
          aria-label={t(MESSAGE.sortVisibleByName)}
          onClick={() => setDescending(!descending)}
        >
          {t(MESSAGE.itemName)}{' '}
          <span className={descending ? 'sort-descending' : ''}>
            <Icon name="arrow-up" size={15} />
          </span>
        </button>
        <span className="column-kind">{t(MESSAGE.typeFilter)}</span>
        <span className="column-access">{t(MESSAGE.accessLabel)}</span>
      </div>
      {loading ? (
        <div className="library-loading" role="status">
          {t(MESSAGE.loading)}
        </div>
      ) : (
        <>
          {!!items.folders.length && (
            <div className="file-list folder-list">
              <FolderRows folders={items.folders} {...folderActions} />
            </div>
          )}
          {!!items.documents.length && (
            <div className="file-list document-list">
              <DocumentRows
                documents={items.documents}
                trash={scope === 'trash'}
                view={view}
                {...documentActions}
              />
            </div>
          )}
          {empty && (
            <div className="library-empty">
              <Icon name={scope === 'trash' ? 'trash' : 'folder'} size={42} />
              <h2>
                {t(
                  query || kind !== 'all'
                    ? MESSAGE.noMatchingItems
                    : scope === 'trash'
                      ? MESSAGE.trashIsEmpty
                      : scope === 'shared'
                        ? MESSAGE.nothingSharedYet
                        : MESSAGE.yourSpaceForDocuments,
                )}
              </h2>
              <p>
                {t(
                  query || kind !== 'all'
                    ? MESSAGE.tryAnotherSearch
                    : scope === 'mine'
                      ? MESSAGE.createFirstItem
                      : scope === 'trash'
                        ? MESSAGE.deletedDocumentsAreRetainedFor14Days
                        : MESSAGE.sharedItemsAppearHere,
                )}
              </p>
              {(query || kind !== 'all') && (
                <button
                  onClick={() => {
                    setKind('all');
                    onClearSearch();
                  }}
                >
                  {t(MESSAGE.clearFilters)}
                </button>
              )}
            </div>
          )}
          {hasMore && kind !== 'folders' && (
            <div className="library-pagination">
              <button onClick={onLoadMore}>{t(MESSAGE.loadMore)}</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
