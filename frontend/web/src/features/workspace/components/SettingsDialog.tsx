'use client';
import { useEffect, useRef, useState } from 'react';
import { MESSAGE, useI18n } from '@/lib/i18n';
import type { Locale } from '@/config/locale';
import type { Theme } from '../hooks/usePreferences';
import { Icon, type IconName } from '@/components/ui/Icon';
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
  const [activeSection, setActiveSection] = useState('account');
  const sections = [
    { id: 'account', label: MESSAGE.settingsAccount, icon: 'user' },
    { id: 'appearance', label: MESSAGE.appearance, icon: 'monitor' },
    { id: 'language', label: MESSAGE.language, icon: 'globe' },
    { id: 'security', label: MESSAGE.settingsSecurity, icon: 'shield' },
  ] satisfies { id: string; label: (typeof MESSAGE)[keyof typeof MESSAGE]; icon: IconName }[];
  const [methods, setMethods] = useState<CredentialStatus | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [accountNotice, setAccountNotice] = useState('');
  useEffect(() => {
    const previous = document.activeElement;
    const accountTrigger = document.querySelector<HTMLElement>(
      '.account-menu .action-menu-trigger',
    );
    dialog.current?.showModal();
    return () => {
      requestAnimationFrame(() => {
        const target =
          previous instanceof HTMLElement && previous.isConnected && previous !== document.body
            ? previous
            : accountTrigger;
        target?.focus();
      });
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
      <div className="settings-mobile-header">
        <h2>{t(MESSAGE.settings)}</h2>
        <button className="settings-close" aria-label={t(MESSAGE.close)} onClick={onClose}>
          <Icon name="close" size={20} />
        </button>
      </div>
      <nav className="settings-navigation" aria-label={t(MESSAGE.settings)}>
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            aria-current={activeSection === section.id ? 'location' : undefined}
            onClick={() => {
              setActiveSection(section.id);
              const target = dialog.current?.querySelector<HTMLElement>(`#settings-${section.id}`);
              target?.scrollIntoView({ block: 'start' });
              target?.focus({ preventScroll: true });
            }}
          >
            <Icon name={section.icon} size={23} />
            <span>{t(section.label)}</span>
          </button>
        ))}
      </nav>
      <div className="settings-content">
        <header className="settings-intro">
          <h2>{t(MESSAGE.settings)}</h2>
          <p>{t(MESSAGE.settingsDescription)}</p>
        </header>
        <section
          id="settings-account"
          className="settings-section"
          tabIndex={-1}
          aria-labelledby="settings-account-title"
        >
          <h3 id="settings-account-title">{t(MESSAGE.settingsAccount)}</h3>
          <p>{t(MESSAGE.settingsAccountDescription)}</p>
          <div className="settings-profile-card">
            <div className="settings-profile-row">
              <Avatar name={user.displayName} src={user.avatarUrl} size={72} />
              <div>
                <strong>{user.displayName}</strong>
                <p>{user.email}</p>
                <p className="settings-photo-help" id="settings-photo-help">
                  {t(MESSAGE.uploadProfilePicture)}
                </p>
              </div>
            </div>
            <div className="settings-photo-actions">
              <label className="settings-avatar-upload">
                <Icon name="upload" size={19} />
                <span>{t(MESSAGE.changePhoto)}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  aria-describedby="settings-photo-help"
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
            </div>
          </div>
        </section>
        <section
          id="settings-appearance"
          className="settings-section"
          tabIndex={-1}
          aria-labelledby="settings-appearance-title"
        >
          <h3 id="settings-appearance-title">{t(MESSAGE.appearance)}</h3>
          <p>{t(MESSAGE.settingsAppearanceDescription)}</p>
          <fieldset className="theme-options" aria-labelledby="settings-appearance-title">
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
        </section>
        <section
          id="settings-language"
          className="settings-section"
          tabIndex={-1}
          aria-labelledby="settings-language-title"
        >
          <h3 id="settings-language-title">{t(MESSAGE.language)}</h3>
          <p>{t(MESSAGE.settingsLanguageDescription)}</p>
          <div className="settings-language-control">
            <Icon name="globe" size={22} />
            <LanguageSelector onLocale={onLocale} inlineMenu />
          </div>
        </section>
        <section
          id="settings-security"
          className="settings-section"
          tabIndex={-1}
          aria-labelledby="settings-security-title"
          aria-busy={busy}
        >
          <h3 id="settings-security-title">{t(MESSAGE.settingsSecurity)}</h3>
          <p>{t(MESSAGE.settingsSecurityDescription)}</p>
          {methods && (
            <div className="settings-security-card">
              <details className="settings-account-section">
                <summary>
                  <span className="settings-security-icon">
                    <Icon name="lock" size={22} />
                  </span>
                  <span>
                    <strong>{t(MESSAGE.password)}</strong>
                    <span className="settings-security-hint">
                      {t(
                        methods.googleLinked
                          ? MESSAGE.googleOnlyPasswordHelp
                          : MESSAGE.settingsPasswordRequiresGoogle,
                      )}
                    </span>
                  </span>
                  <span className="settings-security-action">
                    {t(MESSAGE.settingsChangePassword)}
                  </span>
                  <Icon name="chevron-down" size={18} />
                </summary>
                <div className="settings-credentials">
                  {methods.googleLinked ? (
                    <>
                      <label className="settings-field">
                        <span>{t(MESSAGE.newPassword)}</span>
                        <input
                          type="password"
                          autoComplete="new-password"
                          minLength={12}
                          maxLength={128}
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
                      {!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
                        <p>{t(MESSAGE.settingsGoogleUnavailable)}</p>
                      )}
                    </>
                  ) : (
                    <p>{t(MESSAGE.settingsPasswordRequiresGoogle)}</p>
                  )}
                </div>
              </details>
              <details className="settings-account-section">
                <summary>
                  <span className="settings-security-icon">
                    <Icon name="globe" size={22} />
                  </span>
                  <span>
                    <strong>{t(MESSAGE.settingsGoogleAccount)}</strong>
                    <span className="settings-security-hint">
                      {t(
                        methods.googleLinked
                          ? MESSAGE.settingsGoogleLinked
                          : MESSAGE.linkGoogleHelp,
                      )}
                    </span>
                  </span>
                  <Icon name="chevron-down" size={18} />
                </summary>
                <div className="settings-credentials">
                  {methods.googleLinked && !methods.hasPassword ? (
                    <p>{t(MESSAGE.googleOnlyPasswordHelp)}</p>
                  ) : (
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
                      {methods.googleLinked ? (
                        <button
                          type="button"
                          disabled={busy || !currentPassword}
                          onClick={() => void act(() => unlinkGoogle(currentPassword))}
                        >
                          {t(MESSAGE.unlinkGoogle)}
                        </button>
                      ) : (
                        <>
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
                          {!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
                            <p>{t(MESSAGE.settingsGoogleUnavailable)}</p>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
              </details>
            </div>
          )}
          {!methods && !accountError && <p role="status">{t(MESSAGE.loading)}</p>}
          {accountError && (
            <p className="dialog-error" role="alert">
              {accountError}
            </p>
          )}
          {accountNotice && <p role="status">{accountNotice}</p>}
        </section>
        <div className="settings-saved">
          <Icon name="check" size={22} />
          <div>
            <p>
              {t(
                sessionOnly
                  ? MESSAGE.preferencesSessionOnly
                  : MESSAGE.preferencesSavedAutomatically,
              )}
            </p>
            {!sessionOnly && <p>{t(MESSAGE.preferencesBrowserLocal)}</p>}
          </div>
        </div>
      </div>
    </dialog>
  );
}
