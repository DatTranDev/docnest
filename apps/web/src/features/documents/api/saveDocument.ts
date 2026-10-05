import { sha256 } from '@ted/editor-core';
import { currentSession } from '@/features/auth';
import { ApiError, request } from '@/lib/http';
import type { Version } from '../model/types';
export async function saveNativeVersion(
  documentId: string,
  expectedHeadRevision: number,
  native: Uint8Array,
): Promise<{ version: Version; noChange: boolean }> {
  const ticket = await request<{
    uploadId: string;
    uploadUrl: string;
    kind: string;
    requiredHeaders: Record<string, string>;
  }>(`/api/v1/documents/${documentId}/uploads`, 'POST', {
    expectedHeadRevision,
    nativeBytes: native.length,
    nativeSha256: await sha256(native),
  });
  const headers = new Headers(ticket.requiredHeaders),
    session = currentSession();
  if (ticket.kind === 'LOCAL' && session)
    headers.set('Authorization', `Bearer ${session.accessToken}`);
  const uploaded = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    headers,
    cache: 'no-store',
    body: new Blob([native as Uint8Array<ArrayBuffer>]),
    credentials: ticket.kind === 'LOCAL' ? 'include' : 'omit',
  });
  if (!uploaded.ok) throw new Error(`Tải lên thất bại (${uploaded.status}).`);
  const key = crypto.randomUUID(),
    body = { uploadId: ticket.uploadId, expectedHeadRevision };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await request(`/api/v1/documents/${documentId}/versions`, 'POST', body, {
        'Idempotency-Key': key,
      });
    } catch (error) {
      if (error instanceof ApiError || attempt === 2) throw error;
    }
  }
  throw new Error('Không xác nhận được lưu. Bản nháp vẫn còn.');
}
