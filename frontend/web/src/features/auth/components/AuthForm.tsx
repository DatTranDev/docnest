'use client';
import { LanguageSelector } from '@/components/ui/LanguageSelector';
import { MESSAGE, useI18n } from '@/lib/i18n';

import { ACCOUNT_INPUT_LIMITS } from '../model/constants';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { errorMessage } from '@/lib/http';
import { login, loginWithGoogle, register as registerAccount } from '../api/auth';
import type { User } from '../model/types';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: { theme: string; size: string; shape: string; width: number; text: string },
          ) => void;
        };
      };
    };
  }
}
export function AuthForm({
  onLogin,
  error,
  setError,
}: {
  onLogin: (u: User) => void;
  error: string;
  setError: (s: string) => void;
}) {
  const { t, errorText } = useI18n();

  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [showPassword, setShowPassword] = useState(false),
    [fieldErrors, setFieldErrors] = useState({ displayName: '', email: '', password: '' });
  const googleButton = useRef<HTMLDivElement>(null);
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  useEffect(() => {
    if (!googleClientId || !googleButton.current) return;
    const mount = () => {
      if (!window.google || !googleButton.current) return;
      googleButton.current.replaceChildren();
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (response) => {
          if (!response.credential) return;
          setBusy(true);
          setError('');
          void loginWithGoogle(response.credential)
            .then((session) => onLogin(session.user))
            .catch((failure) => setError(errorMessage(failure)))
            .finally(() => setBusy(false));
        },
      });
      window.google.accounts.id.renderButton(googleButton.current, {
        theme: 'outline',
        size: 'large',
        shape: 'rectangular',
        width: Math.min(360, googleButton.current.clientWidth || 360),
        text: 'continue_with',
      });
    };
    if (window.google) {
      mount();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = mount;
    document.head.append(script);
  }, [googleClientId, onLogin, setError]);
  const fieldError = (field: keyof typeof fieldErrors, message: string) =>
    setFieldErrors((current) => ({ ...current, [field]: message }));
  return (
    <div className="auth">
      <div className="panel">
        <header className="auth-header">
          <Link className="auth-brand" href="/intro">
            <span className="brand-icon">
              <Icon name="document" size={21} />
            </span>
            {t(MESSAGE.writingRoom)}
          </Link>
          <LanguageSelector />
        </header>
        <div className="auth-content">
          <Link className="auth-back" href="/intro#editor">
            ← &nbsp;{t(MESSAGE.backToWriting)}
          </Link>
          <h1>{register ? t(MESSAGE.createANewAccount) : t(MESSAGE.signIn)}</h1>
          <p className="auth-description">
            {t(register ? MESSAGE.createAccountDescription : MESSAGE.signInDescription)}
          </p>
          {googleClientId && <div ref={googleButton} className="google-signin-button" />}
          {googleClientId && (
            <div className="auth-divider">
              <span>{t(MESSAGE.or)}</span>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget),
                email = String(data.get('email')),
                password = String(data.get('password'));
              setBusy(true);
              setError('');
              void (async () => {
                if (register)
                  await registerAccount(email, password, String(data.get('displayName')));
                onLogin((await login(email, password)).user);
              })()
                .catch((e) => setError(errorMessage(e)))
                .finally(() => setBusy(false));
            }}
          >
            {register && (
              <label>
                {t(MESSAGE.namePeopleSee)}{' '}
                <input
                  name="displayName"
                  aria-label={t(MESSAGE.displayName)}
                  aria-invalid={!!fieldErrors.displayName}
                  aria-describedby={fieldErrors.displayName ? 'auth-name-error' : undefined}
                  onInvalid={() => fieldError('displayName', t(MESSAGE.displayNameRequired))}
                  onInput={() => fieldError('displayName', '')}
                  required
                  maxLength={ACCOUNT_INPUT_LIMITS.displayName}
                />
                {fieldErrors.displayName && (
                  <span id="auth-name-error" className="field-error">
                    {fieldErrors.displayName}
                  </span>
                )}
              </label>
            )}
            <label>
              Email
              <input
                name="email"
                aria-label="Email"
                type="email"
                placeholder="name@example.com"
                required
                autoComplete="email"
                aria-invalid={!!fieldErrors.email}
                aria-describedby={fieldErrors.email ? 'auth-email-error' : undefined}
                onInvalid={() => fieldError('email', t(MESSAGE.emailInvalid))}
                onInput={() => fieldError('email', '')}
              />
              {fieldErrors.email && (
                <span id="auth-email-error" className="field-error">
                  {fieldErrors.email}
                </span>
              )}
            </label>
            <div className="auth-password">
              <label htmlFor="auth-password">{t(MESSAGE.password)}</label>
              <div className="auth-password-control">
                <input
                  id="auth-password"
                  name="password"
                  aria-label={t(MESSAGE.password)}
                  aria-describedby={
                    [
                      register ? 'auth-password-help' : '',
                      fieldErrors.password ? 'auth-password-error' : '',
                    ]
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                  aria-invalid={!!fieldErrors.password}
                  onInvalid={() => fieldError('password', t(MESSAGE.passwordInvalid))}
                  onInput={() => fieldError('password', '')}
                  type={showPassword ? 'text' : 'password'}
                  minLength={register ? ACCOUNT_INPUT_LIMITS.passwordMin : 1}
                  maxLength={ACCOUNT_INPUT_LIMITS.passwordMax}
                  required
                  autoComplete={register ? 'new-password' : 'current-password'}
                />
                <button type="button" onClick={() => setShowPassword((shown) => !shown)}>
                  {t(showPassword ? MESSAGE.hidePassword : MESSAGE.showPassword)}
                </button>
              </div>
              {register && (
                <p id="auth-password-help" className="field-help">
                  {t(MESSAGE.passwordHelp)}
                </p>
              )}
              {fieldErrors.password && (
                <p id="auth-password-error" className="field-error" role="alert">
                  {fieldErrors.password}
                </p>
              )}
            </div>
            {error && (
              <p role="alert" className="error auth-form-error">
                {errorText(error)}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy
                ? t(MESSAGE.processing)
                : register
                  ? t(MESSAGE.createAccount)
                  : t(MESSAGE.signIn)}
            </button>
          </form>
          <button
            className="auth-switch"
            onClick={() => {
              setRegister(!register);
              setError('');
              setFieldErrors({ displayName: '', email: '', password: '' });
            }}
          >
            {register ? t(MESSAGE.alreadyHaveAnAccount) : t(MESSAGE.createANewAccount)}
          </button>
          <Link className="auth-local-action" href="/intro#editor">
            {t(MESSAGE.writeWithoutAccount)}
          </Link>
        </div>
      </div>
    </div>
  );
}
