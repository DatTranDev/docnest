export interface User {
  id: string;
  email: string;
  displayName: string;
}
export interface Session {
  accessToken: string;
  user: User;
}
