'use client';
import { Avatar } from '@/components/ui/Avatar';
import { MESSAGE, useI18n } from '@/lib/i18n';
import type { Collaborator } from '../model/CollaborationClient';
import { collaboratorColor } from '../model/collaboratorDecorations';

export function CollaboratorList({ members }: { members: Collaborator[] }) {
  const { t } = useI18n();
  const people = [...new Map(members.map((member) => [member.userId, member])).values()];
  if (!people.length) return null;
  return (
    <details className="collaborator-list">
      <summary aria-label={t(MESSAGE.activeCollaborators)} title={t(MESSAGE.activeCollaborators)}>
        <span className="collaborator-stack" aria-hidden="true">
          {people.slice(0, 4).map((member) => (
            <span
              key={member.userId}
              className="collaborator-avatar-ring"
              style={{ borderColor: collaboratorColor(member.userId) }}
            >
              <Avatar name={member.displayName} src={member.avatarUrl} size={25} />
            </span>
          ))}
        </span>
        {people.length > 4 && <span>+{people.length - 4}</span>}
      </summary>
      <div className="collaborator-menu">
        <strong>{t(MESSAGE.activeCollaborators)}</strong>
        <ul>
          {people.map((member) => (
            <li key={member.userId}>
              <Avatar name={member.displayName} src={member.avatarUrl} size={28} />
              <span>{member.displayName}</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
