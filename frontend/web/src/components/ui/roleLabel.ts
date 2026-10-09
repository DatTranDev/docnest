import { MESSAGE } from '@/lib/i18n/messages';
export function roleLabel(role: string): string {
  switch (role) {
    case 'OWNER':
      return MESSAGE.owner;
    case 'EDITOR':
      return MESSAGE.canEdit;
    case 'VIEWER':
      return MESSAGE.viewer;
    default:
      return role;
  }
}
