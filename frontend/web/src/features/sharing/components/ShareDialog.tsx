'use client';
import { MESSAGE, useI18n } from '@/lib/i18n';
import { OptionSelect } from '@/components/ui/OptionSelect';

import { useState, useEffect, useCallback } from 'react';
import { errorMessage } from '@/lib/http';
import { ModalDialog } from '@/components/ui/ModalDialog';
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
  documentTitle,
  ownerName,
  onClose,
}: {
  documentId: string;
  documentTitle?: string;
  ownerName?: string;
  onClose: () => void;
}) {
  const { t, localeTag, errorText } = useI18n();

  const [permissions, setPermissions] = useState<Permission[]>([]),
    [links, setLinks] = useState<ShareLink[]>([]),
    [created, setCreated] = useState(''),
    [error, setError] = useState(''),
    [feedback, setFeedback] = useState(''),
    [busy, setBusy] = useState(false),
    [newRole, setNewRole] = useState('VIEWER');
  const load = useCallback(
    () =>
      listSharing(documentId).then((result) => {
        setPermissions(result.permissions);
        setLinks(result.links);
      }),
    [documentId],
  );
  useEffect(() => {
    void load().catch((e) => setError(errorText(errorMessage(e))));
  }, [load, errorText]);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      await fn();
      await load();
      setFeedback(t(MESSAGE.accessUpdated));
    } catch (e) {
      setError(errorText(errorMessage(e)));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ModalDialog title={t(MESSAGE.share)} onClose={onClose} className="share-dialog">
      <div className="share-dialog-heading">
        <h2>
          {t(MESSAGE.share)} {documentTitle && `“${documentTitle}”`}
        </h2>
        <button type="button" aria-label={t(MESSAGE.close)} onClick={onClose}>
          ×
        </button>
      </div>
      {error && (
        <p className="dialog-error" role="alert">
          {error}
        </p>
      )}
      {feedback && (
        <p className="share-feedback" role="status">
          {feedback}
        </p>
      )}
      <section className="share-section" aria-label={t(MESSAGE.peopleWithAccess)}>
        <h3>{t(MESSAGE.peopleWithAccess)}</h3>
        <form
          className="share-add-person"
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
          <input type="hidden" name="role" value={newRole} />
          <OptionSelect
            label={t(MESSAGE.permission)}
            value={newRole}
            disabled={busy}
            inlineMenu
            onChange={setNewRole}
            options={[
              { value: 'VIEWER', label: t(MESSAGE.viewer) },
              { value: 'EDITOR', label: t(MESSAGE.editor) },
            ]}
          />
          <button className="primary" disabled={busy}>
            {t(MESSAGE.addPerson)}
          </button>
        </form>
        <p className="muted">{t(MESSAGE.shareNoEmail)}</p>
        {ownerName && (
          <div className="share-person-row">
            <span className="share-person-avatar" aria-hidden="true">
              {ownerName.slice(0, 1).toUpperCase()}
            </span>
            <span className="share-person-name">
              {ownerName} ({t(MESSAGE.ownerLabel).toLowerCase()})
            </span>
            <span>{t(MESSAGE.ownerLabel)}</span>
          </div>
        )}
        {permissions.map((p) => (
          <div className="share-person-row" key={p.granteeUserId}>
            <span className="share-person-avatar" aria-hidden="true">
              {(p.displayName ?? p.email ?? '?').slice(0, 1).toUpperCase()}
            </span>
            <span className="share-person-name">{p.email ?? p.displayName ?? p.granteeUserId}</span>
            <OptionSelect
              disabled={busy}
              label={t(MESSAGE.permissionForValue, { p0: p.email ?? p.granteeUserId })}
              value={p.role}
              inlineMenu
              options={[
                { value: 'VIEWER', label: t(MESSAGE.viewer) },
                { value: 'EDITOR', label: t(MESSAGE.editor) },
              ]}
              onChange={(value) => {
                void action(() => changeAccess(documentId, p.granteeUserId, value));
              }}
            />
            <button
              disabled={busy}
              onClick={() => {
                void action(() => revokeAccess(documentId, p.granteeUserId));
              }}
            >
              {t(MESSAGE.revoke)}{' '}
            </button>
          </div>
        ))}
      </section>
      <section
        className="share-section share-link-section"
        aria-label={t(MESSAGE.anyoneWithLinkCanView)}
      >
        <div>
          <h3>{t(MESSAGE.anyoneWithLinkCanView)}</h3>
          <p className="muted">{t(MESSAGE.linkExpiresInSevenDays)}</p>
        </div>
        <button
          disabled={busy}
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
          <div className="share-created-link">
            <strong>{t(MESSAGE.publicLink)}</strong>
            <input aria-label={t(MESSAGE.publicLink)} value={created} readOnly />
            <button
              onClick={() => {
                void navigator.clipboard
                  .writeText(created)
                  .then(() => setFeedback(t(MESSAGE.linkCopied)))
                  .catch((failure) => setError(errorText(errorMessage(failure))));
              }}
            >
              {t(MESSAGE.copy)}{' '}
            </button>
          </div>
        )}
        {links.map((l) => (
          <div className="share-existing-link" key={l.id}>
            <span>
              {t(MESSAGE.expires)} {new Date(l.expiresAt).toLocaleString(localeTag)} ·{' '}
              {l.revokedAt ? t(MESSAGE.revoked) : t(MESSAGE.active)}
            </span>
            {!l.revokedAt && (
              <button
                disabled={busy}
                onClick={() => {
                  void action(() => revokeShareLink(documentId, l.id));
                }}
              >
                {t(MESSAGE.revokeLink)}{' '}
              </button>
            )}
          </div>
        ))}
        <p className="share-warning">{t(MESSAGE.peopleMayKeepCopies)}</p>
      </section>
    </ModalDialog>
  );
}
