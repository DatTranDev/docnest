import { request, type Page } from '@/lib/http';
import type { Folder } from '../model/types';
export async function listFolders(parent: string | null, cursor?: string): Promise<Page<Folder>> {
  const query = new URLSearchParams({ limit: '50' });
  if (parent) query.set('parent', parent);
  if (cursor) query.set('cursor', cursor);
  return request(`/api/v1/folders?${query}`);
}
export async function listAllFolders(): Promise<Folder[]> {
  const result: Folder[] = [],
    queue: (string | null)[] = [null];
  while (queue.length) {
    const parent = queue.shift()!;
    let cursor: string | undefined;
    do {
      const page = await listFolders(parent, cursor);
      result.push(...page.items);
      queue.push(...page.items.map((folder) => folder.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  return result;
}
export function createFolder(name: string, parentId: string | null): Promise<Folder> {
  return request('/api/v1/folders', 'POST', { name, parentId });
}
export function renameFolder(folder: Folder, name: string): Promise<Folder> {
  return request(`/api/v1/folders/${folder.id}`, 'PATCH', {
    name,
    expectedMetadataRevision: folder.metadataRevision,
  });
}
export function moveFolder(folder: Folder, parentId: string | null): Promise<Folder> {
  return request(`/api/v1/folders/${folder.id}`, 'PATCH', {
    parentId,
    expectedMetadataRevision: folder.metadataRevision,
  });
}
export function deleteFolder(folder: Folder): Promise<void> {
  return request(
    `/api/v1/folders/${folder.id}?expectedMetadataRevision=${folder.metadataRevision}`,
    'DELETE',
  );
}
