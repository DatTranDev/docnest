'use client';
import { MESSAGE, useI18n } from '@/lib/i18n';

import { useState, useEffect, useCallback } from 'react';
import { errorMessage } from '@/lib/http';
import {
  listSharing,
  grantAccess,
  changeAccess,
  revokeAccess,
  createShareLink,
  revokeShareLink,
} from '../api/sharing';
import type { Permission, ShareLink } from '../model/types';
export function ShareDialog({
  documentId,
  onClose,
  setError,
}: {
  documentId: string;
  onClose: () => void;
  setError: (s: string) => void;
}) {
  const { t, localeTag } = useI18n();

  const [permissions, setPermissions] = useState<Permission[]>([]),
    [links, setLinks] = useState<ShareLink[]>([]),
    [created, setCreated] = useState('');
  const load = useCallback(
    () =>
      listSharing(documentId).then((result) => {
        setPermissions(result.permissions);
        setLinks(result.links);
      }),
    [documentId],
  );
  useEffect(() => {
    void load().catch((e) => setError(errorMessage(e)));
  }, [load, setError]);
  async function action(fn: () => Promise<unknown>) {
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <div className="modal" role="dialog" aria-label={t(MESSAGE.share)}>
      <div className="panel">
        <h2>{t(MESSAGE.shareDocument)}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void action(() =>
              grantAccess(documentId, String(f.get('email')), String(f.get('role'))),
            );
          }}
        >
          <input
            type="email"
            name="email"
            aria-label={t(MESSAGE.recipientEmail)}
            placeholder={t(MESSAGE.registeredEmail)}
            required
          />
          <select name="role" aria-label={t(MESSAGE.permission)}>
            <option value="VIEWER">{t(MESSAGE.viewer)}</option>
            <option value="EDITOR">{t(MESSAGE.editor)}</option>
          </select>
          <button>{t(MESSAGE.grantAccess)}</button>
        </form>
        {permissions.map((p) => (
          <div className="row" key={p.granteeUserId}>
            <span>{p.email ?? p.displayName ?? p.granteeUserId}</span>
            <select
              aria-label={t(MESSAGE.permissionForValue, { p0: p.email ?? p.granteeUserId })}
              value={p.role}
              onChange={(e) => {
                void action(() => changeAccess(documentId, p.granteeUserId, e.target.value));
              }}
            >
              <option value="VIEWER">{t(MESSAGE.viewer)}</option>
              <option value="EDITOR">{t(MESSAGE.editor)}</option>
            </select>
            <button
              onClick={() => {
                void action(() => revokeAccess(documentId, p.granteeUserId));
              }}
            >
              {t(MESSAGE.revoke)}{' '}
            </button>
          </div>
        ))}
        <h3>{t(MESSAGE.readOnlyPublicLinks)}</h3>
        <button
          onClick={() => {
            void action(async () => {
              const c = await createShareLink(documentId);
              setCreated(`${location.origin}${c.viewerPath}`);
            });
          }}
        >
          {t(MESSAGE.createA7DayLink)}{' '}
        </button>
        {created && (
          <div className="row">
            <input aria-label={t(MESSAGE.publicLink)} value={created} readOnly />
            <button
              onClick={() => {
                void navigator.clipboard.writeText(created);
              }}
            >
              {t(MESSAGE.copy)}{' '}
            </button>
          </div>
        )}
        {links.map((l) => (
          <div className="row" key={l.id}>
            <span>
              {t(MESSAGE.expires)} {new Date(l.expiresAt).toLocaleString(localeTag)} ·{' '}
              {l.revokedAt ? t(MESSAGE.revoked) : t(MESSAGE.active)}
            </span>
            {!l.revokedAt && (
              <button
                onClick={() => {
                  void action(() => revokeShareLink(documentId, l.id));
                }}
              >
                {t(MESSAGE.revokeLink)}{' '}
              </button>
            )}
          </div>
        ))}
        <p className="muted">{t(MESSAGE.recipientsMayRetainDownloadedCopiesRestoringFromTrash)} </p>
        <button onClick={onClose}>{t(MESSAGE.close)}</button>
      </div>
    </div>
  );
}
