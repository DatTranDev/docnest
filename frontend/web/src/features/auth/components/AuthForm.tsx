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
import { AuthProductPreview } from './AuthProductPreview';

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
            options: {
              theme: string;
              size: string;
              shape: string;
              width: number;
              text: string;
              locale: string;
            },
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
  const { t, errorText, locale } = useI18n();

  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [showPassword, setShowPassword] = useState(false),
    [fieldErrors, setFieldErrors] = useState({ displayName: '', email: '', password: '' });
  const errorNotice = useRef<HTMLParagraphElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (error) errorNotice.current?.focus();
  }, [error]);
  const googleButton = useRef<HTMLDivElement>(null);
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  useEffect(() => {
    const target = googleButton.current;
    if (!googleClientId || !target) return;
    let active = true;
    let renderedWidth = 0;
    const render = () => {
      if (!active || !window.google) return;
      const width = Math.min(360, Math.floor(target.clientWidth));
      if (width <= 0 || width === renderedWidth) return;
      renderedWidth = width;
      target.replaceChildren();
      window.google.accounts.id.renderButton(target, {
        theme: 'outline',
        size: 'large',
        shape: 'rectangular',
        width,
        text: 'continue_with',
        locale,
      });
    };
    const mount = () => {
      if (!active || !window.google) return;
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
      render();
    };
    const observer = new ResizeObserver(render);
    observer.observe(target);
    let script: HTMLScriptElement | undefined;
    if (window.google) mount();
    else {
      script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = mount;
      document.head.append(script);
    }
    return () => {
      active = false;
      observer.disconnect();
      script?.remove();
    };
  }, [googleClientId, onLogin, setError, locale]);
  const fieldError = (field: keyof typeof fieldErrors, message: string) =>
    setFieldErrors((current) => ({ ...current, [field]: message }));
  const changeMode = (next: boolean) => {
    setRegister(next);
    setShowPassword(false);
    setError('');
    setFieldErrors({ displayName: '', email: '', password: '' });
    heading.current?.focus();
  };
  return (
    <main className="auth">
      <div className="panel">
        <div className="auth-layout">
          <aside className="auth-story" aria-label={t(MESSAGE.authWorkspaceLabel)}>
            <h2>{t(MESSAGE.authWorkspaceHeadline)}</h2>
            <p>{t(MESSAGE.authWorkspaceDescription)}</p>
            <AuthProductPreview />
            <ul className="auth-benefits">
              <li>
                <Icon name="folder" />
                {t(MESSAGE.authOrganizeBenefit)}
              </li>
              <li>
                <Icon name="history" />
                {t(MESSAGE.authHistoryBenefit)}
              </li>
              <li>
                <Icon name="shared" />
                {t(MESSAGE.authSharingBenefit)}
              </li>
            </ul>
          </aside>
          <div className="auth-content">
            <div className="auth-mode" role="group" aria-label={t(MESSAGE.authModeLabel)}>
              <button
                type="button"
                aria-label={`${t(MESSAGE.signIn)}: ${t(MESSAGE.alreadyHaveAnAccount)}`}
                aria-pressed={!register}
                disabled={busy}
                onClick={() => changeMode(false)}
              >
                {t(MESSAGE.signIn)}
              </button>
              <button
                type="button"
                aria-label={t(MESSAGE.createANewAccount)}
                aria-pressed={register}
                disabled={busy}
                onClick={() => changeMode(true)}
              >
                {t(MESSAGE.createAccount)}
              </button>
            </div>
            <h1 ref={heading} tabIndex={-1}>
              {register ? t(MESSAGE.createANewAccount) : t(MESSAGE.signIn)}
            </h1>
            <p className="auth-description">
              {t(register ? MESSAGE.createAccountDescription : MESSAGE.signInDescription)}
            </p>
            {googleClientId && (
              <div ref={googleButton} className="google-signin-button" inert={busy} />
            )}
            {googleClientId && (
              <div className="auth-divider">
                <span>{t(MESSAGE.or)}</span>
              </div>
            )}
            <form
              aria-busy={busy}
              onSubmit={(e) => {
                e.preventDefault();
                if (busy) return;
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
              <fieldset disabled={busy}>
                {register && (
                  <label>
                    {t(MESSAGE.namePeopleSee)}{' '}
                    <input
                      name="displayName"
                      autoComplete="nickname"
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
                    maxLength={254}
                    autoCapitalize="none"
                    spellCheck={false}
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
                    <button
                      type="button"
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((shown) => !shown)}
                    >
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
                  <p ref={errorNotice} tabIndex={-1} role="alert" className="error auth-form-error">
                    {errorText(error)}
                  </p>
                )}
                <button className="primary" disabled={busy}>
                  {busy
                    ? t(MESSAGE.processing)
                    : register
                      ? t(MESSAGE.createAccount)
                      : t(MESSAGE.signIn)}
                  {!busy && <Icon name="chevron" size={18} />}
                </button>
              </fieldset>
            </form>
            <Link className="auth-local-action" href="/intro#editor">
              {t(MESSAGE.writeWithoutAccount)}
            </Link>
            <p className="auth-local-note">{t(MESSAGE.authLocalNote)}</p>
            <div className="auth-language-footer">
              <LanguageSelector />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
