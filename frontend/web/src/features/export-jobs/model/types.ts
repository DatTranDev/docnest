export interface Job {
  id: string;
  documentId: string;
  revision: number;
  type: 'EXPORT_TXT' | 'EXPORT_HTML' | 'EXPORT_DOCX' | 'EXPORT_PDF';
  state: 'QUEUED' | 'READY' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  errorCode: string | null;
}
