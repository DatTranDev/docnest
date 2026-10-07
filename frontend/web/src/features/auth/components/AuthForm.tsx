'use client';
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
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false);
  return (
    <div className="auth">
      <div className="panel">
        <h1>Trang viết</h1>
        <p>Tài liệu riêng tư, định dạng gọn nhẹ.</p>
        <h2>{register ? 'Tạo tài khoản' : 'Đăng nhập'}</h2>
        {error && (
          <p role="alert" className="error">
            {error}
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
              Tên hiển thị
              <input name="displayName" aria-label="Tên hiển thị" required maxLength={100} />
            </label>
          )}
          <label>
            Email
            <input name="email" aria-label="Email" type="email" required autoComplete="email" />
          </label>
          <label>
            Mật khẩu
            <input
              name="password"
              aria-label="Mật khẩu"
              type="password"
              minLength={register ? 12 : 1}
              maxLength={128}
              required
              autoComplete={register ? 'new-password' : 'current-password'}
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? 'Đang xử lý…' : register ? 'Tạo tài khoản' : 'Đăng nhập'}
          </button>
        </form>
        <button
          onClick={() => {
            setRegister(!register);
            setError('');
          }}
        >
          {register ? 'Đã có tài khoản' : 'Tạo tài khoản mới'}
        </button>
      </div>
    </div>
  );
}
