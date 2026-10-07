export interface Permission {
  granteeUserId: string;
  email?: string;
  displayName?: string;
  role: 'VIEWER' | 'EDITOR';
}
export interface ShareLink {
  id: string;
  expiresAt: string;
  revokedAt: string | null;
}
export interface PublicShare {
  title: string;
  empty: boolean;
  contentPath: string | null;
}
