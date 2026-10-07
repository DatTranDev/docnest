export interface Folder {
  id: string;
  parentId: string | null;
  name: string;
  metadataRevision: number;
}
