'use client';
import { useEffect, useRef, useState } from 'react';
import { MESSAGE, useI18n } from '@/lib/i18n';
import type { Locale } from '@/config/locale';
import type { Theme } from '../hooks/usePreferences';
import { Icon } from '@/components/ui/Icon';
import { LanguageSelector } from '@/components/ui/LanguageSelector';
import { Avatar } from '@/components/ui/Avatar';
import {
  credentialStatus,
  GoogleCredentialButton,
  linkGoogle,
  removeAvatar,
  setupPassword,
  unlinkGoogle,
  uploadAvatar,
  type CredentialStatus,
  type User,
} from '@/features/auth';
import { errorMessage } from '@/lib/http';

export function SettingsDialog({
  theme,
  sessionOnly,
  onLocale,
  onTheme,
  onClose,
  user,
  onUserUpdated,
}: {
  theme: Theme;
  sessionOnly: boolean;
  onLocale: (locale: Locale) => void;
  onTheme: (theme: Theme) => void;
  onClose: () => void;
  user: User;
  onUserUpdated: (user: User) => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [methods, setMethods] = useState<CredentialStatus | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [accountNotice, setAccountNotice] = useState('');
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  useEffect(() => {
    void credentialStatus()
      .then(setMethods)
      .catch((error) => setAccountError(errorMessage(error)));
  }, []);
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setAccountError('');
    setAccountNotice('');
    try {
      await action();
      setMethods(await credentialStatus());
      setCurrentPassword('');
      setNewPassword('');
      setAccountNotice(t(MESSAGE.accountUpdated));
    } catch (error) {
      setAccountError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      aria-label={t(MESSAGE.settings)}
      onCancel={onClose}
    >
      <div className="settings-heading">
        <span className="settings-brand">
          <span className="brand-icon">
            <Icon name="document" size={20} />
          </span>
          {t(MESSAGE.writingRoom)}
        </span>
        <button aria-label={t(MESSAGE.close)} onClick={onClose}>
          ×
        </button>
      </div>
      <div className="settings-content">
        <h2>{t(MESSAGE.settings)}</h2>
        <section className="settings-account-section" aria-label={t(MESSAGE.profilePicture)}>
          <div className="settings-profile-row">
            <Avatar name={user.displayName} src={user.avatarUrl} size={48} />
            <div>
              <strong>{user.displayName}</strong>
              <p className="muted">{user.email}</p>
            </div>
          </div>
          <label className="settings-avatar-upload">
            {t(MESSAGE.uploadProfilePicture)}
            <input
              type="file"
              accept="image/png,image/jpeg"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file)
                  void act(async () => {
                    onUserUpdated(await uploadAvatar(file));
                  });
                event.target.value = '';
              }}
            />
          </label>
          {user.avatarSource === 'CUSTOM' && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  onUserUpdated(await removeAvatar());
                })
              }
            >
              {t(MESSAGE.removeProfilePicture)}
            </button>
          )}
        </section>
        <p className="muted">
          {t(sessionOnly ? MESSAGE.preferencesSessionOnly : MESSAGE.preferencesBrowserLocal)}
        </p>
        <label className="settings-field">
          <span>{t(MESSAGE.language)}</span>
          <LanguageSelector onLocale={onLocale} inlineMenu />
        </label>
        <fieldset className="theme-options">
          <legend>{t(MESSAGE.appearance)}</legend>
          {(['light', 'dark', 'system'] as const).map((mode) => (
            <label key={mode} className={`theme-option theme-${mode}`}>
              <input
                type="radio"
                name="theme"
                value={mode}
                checked={theme === mode}
                onChange={() => onTheme(mode)}
              />
              <span className="theme-sample" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span>
                {t(
                  mode === 'light'
                    ? MESSAGE.lightTheme
                    : mode === 'dark'
                      ? MESSAGE.darkTheme
                      : MESSAGE.systemTheme,
                )}
              </span>
            </label>
          ))}
        </fieldset>
        {methods && (
          <section className="settings-account-section" aria-label={t(MESSAGE.signInMethods)}>
            <h3>{t(MESSAGE.signInMethods)}</h3>
            {methods.googleLinked ? (
              methods.hasPassword ? (
                <>
                  <label className="settings-field">
                    <span>{t(MESSAGE.currentPassword)}</span>
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy || !currentPassword}
                    onClick={() => void act(() => unlinkGoogle(currentPassword))}
                  >
                    {t(MESSAGE.unlinkGoogle)}
                  </button>
                  <p className="muted">{t(MESSAGE.resetPasswordWithGoogle)}</p>
                  <label className="settings-field">
                    <span>{t(MESSAGE.newPassword)}</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      minLength={12}
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                    />
                  </label>
                  <GoogleCredentialButton
                    disabled={busy || newPassword.length < 12}
                    onCredential={(credential) =>
                      void act(() => setupPassword(newPassword, credential))
                    }
                  />
                </>
              ) : (
                <>
                  <p className="muted">{t(MESSAGE.googleOnlyPasswordHelp)}</p>
                  <label className="settings-field">
                    <span>{t(MESSAGE.newPassword)}</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      minLength={12}
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                    />
                  </label>
                  <GoogleCredentialButton
                    disabled={busy || newPassword.length < 12}
                    onCredential={(credential) =>
                      void act(() => setupPassword(newPassword, credential))
                    }
                  />
                </>
              )
            ) : (
              <>
                <p className="muted">{t(MESSAGE.linkGoogleHelp)}</p>
                <label className="settings-field">
                  <span>{t(MESSAGE.currentPassword)}</span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                  />
                </label>
                <GoogleCredentialButton
                  disabled={busy || !currentPassword}
                  onCredential={(credential) =>
                    void act(async () => {
                      onUserUpdated(
                        (await linkGoogle(user.email, currentPassword, credential)).user,
                      );
                    })
                  }
                />
              </>
            )}
          </section>
        )}
        {accountError && (
          <p className="dialog-error" role="alert">
            {accountError}
          </p>
        )}
        {accountNotice && <p role="status">{accountNotice}</p>}
        <p className="settings-saved" role="status">
          {t(sessionOnly ? MESSAGE.preferencesSessionOnly : MESSAGE.preferencesSavedAutomatically)}
        </p>
      </div>
    </dialog>
  );
}
