import type { DocumentInfo } from '@/features/documents';
import type { Folder } from '@/features/folders';
export type Scope = 'mine' | 'shared' | 'trash';
export type MoveTarget =
  { kind: 'folder'; item: Folder } | { kind: 'document'; item: DocumentInfo };
