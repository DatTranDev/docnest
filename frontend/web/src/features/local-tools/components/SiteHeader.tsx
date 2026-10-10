'use client';
import { useEffect, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { LanguageSelector } from '@/components/ui/LanguageSelector';
import { Icon } from '@/components/ui/Icon';
import { useToolsCopy } from '../model/copy';
import { useAccountInitial } from '@/features/auth';
export function SiteHeader({
  standalone = false,
  editor = false,
}: {
  standalone?: boolean;
  editor?: boolean;
}) {
  const copy = useToolsCopy();
  const initial = useAccountInitial();
  const workspaceUrl = standalone
    ? process.env.NEXT_PUBLIC_APP_URL ||
      (typeof location !== 'undefined' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
        ? `${location.protocol}//${location.hostname}:8080/`
        : '/')
    : '/';
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => 'system');
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === 'system' ? (query.matches ? 'dark' : 'light') : theme;
    };
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [theme]);
  return (
    <header className="site-header">
      <a className="brand" href={standalone ? './index.html' : '/intro'}>
        <span className="brand-icon">
          <Icon name="document" size={23} />
        </span>
        docsnest
      </a>
      <nav aria-label={copy.navigation}>
        <a
          href={standalone ? './index.html' : '/intro'}
          aria-current={!editor ? 'page' : undefined}
        >
          {copy.intro}
        </a>
        <a
          href={standalone ? './editor.html' : '/local'}
          aria-current={editor ? 'page' : undefined}
        >
          {copy.local}
        </a>
        {!standalone && <Link href="/">{copy.workspace}</Link>}
      </nav>
      <div className="site-settings">
        <LanguageSelector />
        <select
          aria-label={copy.theme}
          value={theme}
          onChange={(event) => {
            const value = event.target.value;
            themeFallback = value;
            try {
              localStorage.setItem('docsnest:local-theme', value);
            } catch {
              /* Session fallback. */
            }
            window.dispatchEvent(new Event('docsnest:local-theme'));
          }}
        >
          <option value="light">{copy.light}</option>
          <option value="dark">{copy.dark}</option>
          <option value="system">{copy.system}</option>
        </select>
        <a
          className={initial ? 'site-account' : 'site-login'}
          href={workspaceUrl}
          aria-label={initial ? copy.manageFiles : copy.login}
          title={initial ? copy.manageFiles : copy.login}
        >
          {initial ? <span className="account-avatar">{initial}</span> : copy.login}
        </a>
      </div>
    </header>
  );
}
let themeFallback = 'system';
function readTheme() {
  try {
    const value = localStorage.getItem('docsnest:local-theme');
    return value && ['light', 'dark', 'system'].includes(value) ? value : themeFallback;
  } catch {
    return themeFallback;
  }
}
function subscribeTheme(listener: () => void) {
  window.addEventListener('storage', listener);
  window.addEventListener('docsnest:local-theme', listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener('docsnest:local-theme', listener);
  };
}
