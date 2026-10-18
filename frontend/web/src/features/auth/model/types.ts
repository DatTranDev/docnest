export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarSource?: 'CUSTOM' | 'GOOGLE' | 'GENERATED';
  avatarUrl?: string | null;
}
export interface Session {
  accessToken: string;
  user: User;
}
