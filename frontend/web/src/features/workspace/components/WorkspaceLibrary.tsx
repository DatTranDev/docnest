'use client';
import { useMemo, useState, type ComponentProps } from 'react';
import {
  DocumentRows,
  sourceFileType,
  type DocumentInfo,
  type DocumentSortBy,
  type SortDirection,
} from '@/features/documents';
import { FolderRows, type Folder } from '@/features/folders';
import { IconButton, SegmentedControl } from '@/components/ui/Controls';
import { Icon } from '@/components/ui/Icon';
import { OptionSelect } from '@/components/ui/OptionSelect';
import { MESSAGE, useI18n } from '@/lib/i18n';
import type { Scope } from '../model/types';
import { useLibraryView } from '../hooks/useLibraryView';

export function WorkspaceLibrary({
  scope,
  path,
  folders,
  documents,
  sortBy,
  sortDirection,
  onSortBy,
  onSortDirection,
  query,
  loading,
  loadError,
  hasMore,
  onLoadMore,
  onPath,
  onClearSearch,
  onRetry,
  folderActions,
  documentActions,
}: {
  scope: Scope;
  path: Folder[];
  folders: Folder[];
  documents: DocumentInfo[];
  sortBy: DocumentSortBy;
  sortDirection: SortDirection;
  onSortBy: (value: DocumentSortBy) => void;
  onSortDirection: () => void;
  query: string;
  loading: boolean;
  loadError: string;
  hasMore: boolean;
  onLoadMore: () => void;
  onPath: (path: Folder[]) => void;
  onClearSearch: () => void;
  onRetry: () => void;
  folderActions: Omit<ComponentProps<typeof FolderRows>, 'folders'>;
  documentActions: Omit<ComponentProps<typeof DocumentRows>, 'documents' | 'trash' | 'view'>;
}) {
  const { t, localeTag } = useI18n();
  const [view, setView] = useLibraryView(scope);
  const [kind, setKind] = useState('all');
  const effectiveKind = scope !== 'mine' && kind === 'folders' ? 'all' : kind;
  const items = useMemo(() => {
    const collator = new Intl.Collator(localeTag, { numeric: true, sensitivity: 'base' });
    const folderDirection = sortBy === 'name' && sortDirection === 'desc' ? -1 : 1;
    return {
      folders:
        effectiveKind !== 'all' && effectiveKind !== 'folders'
          ? []
          : [...folders].sort((a, b) => folderDirection * collator.compare(a.name, b.name)),
      documents:
        effectiveKind === 'folders'
          ? []
          : documents.filter(
              (document) =>
                ['all', 'documents'].includes(effectiveKind) ||
                sourceFileType(document.title) === effectiveKind,
            ),
    };
  }, [folders, documents, effectiveKind, localeTag, sortBy, sortDirection]);
  const title =
    scope === 'mine'
      ? MESSAGE.myDocuments
      : scope === 'shared'
        ? MESSAGE.sharedWithMe
        : MESSAGE.trash;
  const empty = !items.folders.length && !items.documents.length;
  const visibleCount = items.folders.length + items.documents.length;
  const countMessage =
    effectiveKind !== 'folders' && items.folders.length === 0
      ? visibleCount === 1
        ? MESSAGE.oneDocumentShown
        : MESSAGE.documentsShown
      : visibleCount === 1
        ? MESSAGE.oneItemShown
        : MESSAGE.itemsShown;
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
      </div>
      {scope === 'trash' && <p className="trash-restore-note">{t(MESSAGE.restoreAccessWarning)}</p>}
      <div className="workspace-toolbar">
        <div className="type-filter">
          <OptionSelect
            label={t(MESSAGE.typeFilter)}
            value={effectiveKind}
            onChange={setKind}
            options={[
              { value: 'all', label: t(MESSAGE.allItems) },
              ...(scope === 'mine' ? [{ value: 'folders', label: t(MESSAGE.folderPlural) }] : []),
              { value: 'documents', label: t(MESSAGE.documents) },
              { value: 'markdown', label: 'Markdown' },
              { value: 'json', label: 'JSON' },
              { value: 'code', label: 'Code' },
            ]}
          />
        </div>
        <SegmentedControl className="view-switch" aria-label={t(MESSAGE.viewLayout)}>
          {(['list', 'grid'] as const).map((layout) => (
            <IconButton
              key={layout}
              aria-label={t(layout === 'grid' ? MESSAGE.gridView : MESSAGE.listView)}
              title={t(layout === 'grid' ? MESSAGE.gridView : MESSAGE.listView)}
              aria-pressed={view === layout}
              onClick={() => setView(layout)}
            >
              <Icon name={layout} size={17} />
            </IconButton>
          ))}
        </SegmentedControl>
        {query && (
          <button
            className="search-chip"
            aria-label={`${t(MESSAGE.clearSearch)}: ${query}`}
            onClick={onClearSearch}
          >
            <span>{query}</span>
            <Icon name="close" size={15} />
          </button>
        )}
        <span className="library-count">{t(countMessage, { p0: visibleCount })}</span>
      </div>
      <div className="library-columns" role="group" aria-label={t(MESSAGE.sortBy)}>
        {(
          [
            ['name', MESSAGE.itemName],
            ['createdAt', MESSAGE.sortDateCreated],
            ['size', MESSAGE.sortSize],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={`column-sort column-${key}`}
            aria-label={`${t(MESSAGE.sortBy)}: ${t(label)}${sortBy === key ? `, ${t(sortDirection === 'asc' ? MESSAGE.sortAscending : MESSAGE.sortDescending)}` : ''}`}
            onClick={() => (sortBy === key ? onSortDirection() : onSortBy(key))}
          >
            {t(label)}
            {sortBy === key && (
              <span className={sortDirection === 'desc' ? 'sort-descending' : ''}>
                <Icon name="arrow-up" size={14} />
              </span>
            )}
          </button>
        ))}
        <span className="mobile-library-count">
          {t(visibleCount === 1 ? MESSAGE.libraryOneItem : MESSAGE.libraryItemCount, {
            p0: visibleCount,
          })}
        </span>
        <span className="column-kind">{t(MESSAGE.typeFilter)}</span>
        <span className="column-access">{t(MESSAGE.accessLabel)}</span>
      </div>
      {!loading && loadError && !empty && (
        <div className="library-error library-error-inline" role="alert">
          <span>{t(MESSAGE.libraryLoadFailed)}</span>
          <button onClick={onRetry}>{t(MESSAGE.retry)}</button>
        </div>
      )}
      {loading ? (
        <div className="library-loading" role="status">
          <span className="visually-hidden">{t(MESSAGE.loading)}</span>
          <div className="library-skeleton" aria-hidden="true">
            {[0, 1, 2, 3].map((row) => (
              <div key={row}>
                <span />
                <span />
                <span />
              </div>
            ))}
          </div>
        </div>
      ) : loadError && empty ? (
        <div className="library-error" role="alert">
          <h2>{t(MESSAGE.libraryLoadFailed)}</h2>
          <p>{t(MESSAGE.libraryLoadAdvice)}</p>
          <button className="primary" onClick={onRetry}>
            {t(MESSAGE.retry)}
          </button>
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
                  hasMore && effectiveKind !== 'all'
                    ? MESSAGE.noMatchingLoadedItems
                    : query || effectiveKind !== 'all'
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
                  hasMore && effectiveKind !== 'all'
                    ? MESSAGE.moreItemsMayMatchFilter
                    : query || effectiveKind !== 'all'
                      ? MESSAGE.tryAnotherSearch
                      : scope === 'mine'
                        ? MESSAGE.createFirstItem
                        : scope === 'trash'
                          ? MESSAGE.deletedDocumentsAreRetainedFor14Days
                          : MESSAGE.sharedItemsAppearHere,
                )}
              </p>
              {(query || effectiveKind !== 'all') && (
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
          {hasMore && effectiveKind !== 'folders' && (
            <div className="library-pagination">
              <button onClick={onLoadMore}>{t(MESSAGE.loadMore)}</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
