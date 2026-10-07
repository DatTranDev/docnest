import { bytes, request } from '@/lib/http';
import type { Job } from '../model/types';
export function createExport(
  documentId: string,
  revision: number,
  type: Job['type'],
): Promise<Job> {
  return request(
    '/api/v1/jobs',
    'POST',
    { documentId, revision, type },
    { 'Idempotency-Key': crypto.randomUUID() },
  );
}
export function getJob(id: string): Promise<Job> {
  return request(`/api/v1/jobs/${id}`);
}
export function cancelJob(id: string): Promise<Job> {
  return request(`/api/v1/jobs/${id}/cancel`, 'POST');
}
export function jobContent(id: string): Promise<Uint8Array> {
  return bytes(`/api/v1/jobs/${id}/content`);
}
