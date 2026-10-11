import {
  listDocuments,
  type DocumentInfo,
  type DocumentSortBy,
  type SortDirection,
} from '@/features/documents';
import { listFolders, type Folder } from '@/features/folders';
import type { Page } from '@/lib/http';
import type { Scope } from '../model/types';

export async function workspaceContents(
  scope: Scope,
  parent: string | null,
  cursor?: string,
  titleQuery?: string,
  sortBy: DocumentSortBy = 'createdAt',
  sortDirection: SortDirection = 'desc',
): Promise<{ listing: Page<DocumentInfo>; folders: Folder[] }> {
  const listing = await listDocuments(
    scope === 'mine' ? 'OWNED' : scope === 'shared' ? 'SHARED' : 'TRASH',
    scope === 'mine' ? parent : null,
    cursor,
    titleQuery,
    sortBy,
    sortDirection,
  );
  const folders: Folder[] = [];
  if (scope === 'mine') {
    let page = await listFolders(parent);
    folders.push(...page.items);
    while (page.nextCursor) {
      page = await listFolders(parent, page.nextCursor);
      folders.push(...page.items);
    }
  }
  return {
    listing,
    folders: titleQuery
      ? folders.filter((folder) =>
          folder.name.toLocaleLowerCase().includes(titleQuery.toLocaleLowerCase()),
        )
      : folders,
  };
}
