import type { EditorModel } from '@ted/editor-core';
export interface DocumentInfo {
  id: string;
  ownerUserId: string;
  folderId: string | null;
  title: string;
  headRevision: number;
  metadataRevision: number;
  effectiveRole: 'OWNER' | 'EDITOR' | 'VIEWER';
  deletedAt: string | null;
  createdAt?: string;
  sizeBytes?: number | null;
  preview?: Record<string, unknown> | null;
}
export type DocumentSortBy = 'createdAt' | 'name' | 'size';
export type SortDirection = 'asc' | 'desc';
export interface Version {
  id: string;
  revision: number;
  createdAt: string;
  createdByUserId: string;
  nativeBytes: number;
}
export type ActiveDocument = {
  document: DocumentInfo;
  model: EditorModel;
  readOnly: boolean;
  revision?: number;
};
export type DocumentScope = 'OWNED' | 'SHARED' | 'TRASH';
