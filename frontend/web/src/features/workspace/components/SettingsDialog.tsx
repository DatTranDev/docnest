'use client';
import { useEffect, useRef } from 'react';
import { MESSAGE, useI18n } from '@/lib/i18n';
import type { Locale } from '@/config/locale';
import type { Theme } from '../hooks/usePreferences';

export function SettingsDialog({
  locale,
  theme,
  onLocale,
  onTheme,
  onClose,
}: {
  locale: Locale;
  theme: Theme;
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
        <h2>{t(MESSAGE.settings)}</h2>
        <button onClick={onClose}>{t(MESSAGE.close)}</button>
      </div>
      <p className="muted">{t(MESSAGE.preferencesPerAccount)}</p>
      <label className="settings-field">
        <span>{t(MESSAGE.language)}</span>
        <select
          aria-label={t(MESSAGE.language)}
          value={locale}
          onChange={(event) => onLocale(event.target.value as Locale)}
        >
          <option value="vi">{t(MESSAGE.vietnamese)}</option>
          <option value="en">{t(MESSAGE.english)}</option>
        </select>
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
        {t(MESSAGE.preferencesSavedAutomatically)}
      </p>
    </dialog>
  );
}
