import { bytes, request, type Page } from '@/lib/http';
import type { DocumentInfo, DocumentScope, Version } from '../model/types';
export function listDocuments(
  scope: DocumentScope,
  parent: string | null,
  cursor?: string,
): Promise<Page<DocumentInfo>> {
  const query = new URLSearchParams({ scope, limit: '50' });
  if (parent) query.set('parent', parent);
  if (cursor) query.set('cursor', cursor);
  return request(`/api/v1/documents?${query}`);
}
export function getDocument(id: string): Promise<DocumentInfo> {
  return request(`/api/v1/documents/${id}`);
}
export function createDocument(title: string, folderId: string | null): Promise<DocumentInfo> {
  return request('/api/v1/documents', 'POST', { title, folderId });
}
export function renameDocument(document: DocumentInfo, title: string): Promise<DocumentInfo> {
  return request(`/api/v1/documents/${document.id}`, 'PATCH', {
    title,
    expectedMetadataRevision: document.metadataRevision,
  });
}
export function moveDocument(
  document: DocumentInfo,
  folderId: string | null,
): Promise<DocumentInfo> {
  return request(`/api/v1/documents/${document.id}`, 'PATCH', {
    folderId,
    expectedMetadataRevision: document.metadataRevision,
  });
}
export function trashDocument(document: DocumentInfo): Promise<void> {
  return request(`/api/v1/documents/${document.id}`, 'DELETE', {
    expectedMetadataRevision: document.metadataRevision,
  });
}
export function restoreDocument(document: DocumentInfo): Promise<DocumentInfo> {
  return request(`/api/v1/documents/${document.id}/restore`, 'POST', {
    expectedMetadataRevision: document.metadataRevision,
  });
}
export function listVersions(documentId: string): Promise<Page<Version>> {
  return request(`/api/v1/documents/${documentId}/versions?limit=20`);
}
export function versionContent(documentId: string, revision: number): Promise<Uint8Array> {
  return bytes(`/api/v1/documents/${documentId}/versions/${revision}/content`);
}
