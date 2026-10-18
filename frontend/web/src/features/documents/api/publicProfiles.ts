import { request } from '@/lib/http';

export type PublicProfile = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

export function publicProfile(userId: string): Promise<PublicProfile> {
  return request<PublicProfile>(`/api/v1/users/${userId}/profile`);
}
