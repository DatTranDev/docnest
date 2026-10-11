'use client';
import { useEffect, useRef } from 'react';
import { MESSAGE, useI18n } from '@/lib/i18n';
import type { Locale } from '@/config/locale';
import type { Theme } from '../hooks/usePreferences';
import { Icon } from '@/components/ui/Icon';
import { LanguageSelector } from '@/components/ui/LanguageSelector';

export function SettingsDialog({
  theme,
  sessionOnly,
  onLocale,
  onTheme,
  onClose,
}: {
  theme: Theme;
  sessionOnly: boolean;
  onLocale: (locale: Locale) => void;
  onTheme: (theme: Theme) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
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
        <p className="settings-saved" role="status">
          {t(sessionOnly ? MESSAGE.preferencesSessionOnly : MESSAGE.preferencesSavedAutomatically)}
        </p>
      </div>
    </dialog>
  );
}
