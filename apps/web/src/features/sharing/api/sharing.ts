import { bytes, request, type Page } from '@/lib/http';
import type { Permission, PublicShare, ShareLink } from '../model/types';
const route = (id: string) => `/api/v1/documents/${id}`;
export async function listSharing(
  id: string,
): Promise<{ permissions: Permission[]; links: ShareLink[] }> {
  const [permissions, links] = await Promise.all([
    request<Page<Permission>>(`${route(id)}/permissions`),
    request<Page<ShareLink>>(`${route(id)}/share-links`),
  ]);
  return { permissions: permissions.items, links: links.items };
}
export function grantAccess(id: string, email: string, role: string): Promise<Permission> {
  return request(`${route(id)}/permissions`, 'POST', { email, role });
}
export function changeAccess(id: string, userId: string, role: string): Promise<Permission> {
  return request(`${route(id)}/permissions/${userId}`, 'PUT', { role });
}
export function revokeAccess(id: string, userId: string): Promise<void> {
  return request(`${route(id)}/permissions/${userId}`, 'DELETE');
}
export function createShareLink(id: string): Promise<{ viewerPath: string }> {
  return request(`${route(id)}/share-links`, 'POST', { expiresInSeconds: 604800 });
}
export function revokeShareLink(id: string, linkId: string): Promise<void> {
  return request(`${route(id)}/share-links/${linkId}`, 'DELETE');
}
export function publicShare(token: string): Promise<PublicShare> {
  return request(`/api/v1/public/shares/${encodeURIComponent(token)}`);
}
export function publicContent(path: string): Promise<Uint8Array> {
  return bytes(path, {}, false);
}
