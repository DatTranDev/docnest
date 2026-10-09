'use client';
import { LanguageSelector } from '@/components/ui/LanguageSelector';
import { MESSAGE, useI18n } from '@/lib/i18n';

import { ACCOUNT_INPUT_LIMITS } from '../model/constants';
import { useState } from 'react';
import { errorMessage } from '@/lib/http';
import { login, register as registerAccount } from '../api/auth';
import type { User } from '../model/types';
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
    [busy, setBusy] = useState(false);
  return (
    <div className="auth">
      <div className="panel">
        <LanguageSelector />
        <h1>{t(MESSAGE.writingRoom)}</h1>
        <p>{t(MESSAGE.privateDocumentsLightweightFormatting)}</p>
        <h2>{register ? t(MESSAGE.createAccount) : t(MESSAGE.signIn)}</h2>
        {error && (
          <p role="alert" className="error">
            {errorText(error)}
          </p>
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
              if (register) await registerAccount(email, password, String(data.get('displayName')));
              onLogin((await login(email, password)).user);
            })()
              .catch((e) => setError(errorMessage(e)))
              .finally(() => setBusy(false));
          }}
        >
          {register && (
            <label>
              {t(MESSAGE.displayName)}{' '}
              <input
                name="displayName"
                aria-label={t(MESSAGE.displayName)}
                required
                maxLength={ACCOUNT_INPUT_LIMITS.displayName}
              />
            </label>
          )}
          <label>
            Email
            <input name="email" aria-label="Email" type="email" required autoComplete="email" />
          </label>
          <label>
            {t(MESSAGE.password)}{' '}
            <input
              name="password"
              aria-label={t(MESSAGE.password)}
              type="password"
              minLength={register ? ACCOUNT_INPUT_LIMITS.passwordMin : 1}
              maxLength={ACCOUNT_INPUT_LIMITS.passwordMax}
              required
              autoComplete={register ? 'new-password' : 'current-password'}
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? t(MESSAGE.processing) : register ? t(MESSAGE.createAccount) : t(MESSAGE.signIn)}
          </button>
        </form>
        <button
          onClick={() => {
            setRegister(!register);
            setError('');
          }}
        >
          {register ? t(MESSAGE.alreadyHaveAnAccount) : t(MESSAGE.createANewAccount)}
        </button>
      </div>
    </div>
  );
}
