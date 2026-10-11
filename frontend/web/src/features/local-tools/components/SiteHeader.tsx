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
  onOpenFile,
}: {
  standalone?: boolean;
  editor?: boolean;
  onOpenFile?: () => void;
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
  const changeTheme = (value: string) => {
    themeFallback = value;
    try {
      localStorage.setItem('docsnest:local-theme', value);
    } catch {
      /* Session fallback. */
    }
    window.dispatchEvent(new Event('docsnest:local-theme'));
  };
  return (
    <header className={`site-header${editor ? ' site-header-editor' : ' site-header-intro'}`}>
      <a className="brand" href={standalone ? './index.html' : '/intro'}>
        <span className="brand-icon">
          <Icon name="document" size={23} />
        </span>
        docsnest
      </a>
      {editor && (
        <a className="site-back-to-tools" href={standalone ? './index.html' : '/intro'}>
          ← <span>{copy.backToTools}</span>
        </a>
      )}
      <nav aria-label={copy.navigation}>
        <a
          href={standalone ? './index.html' : '/intro'}
          aria-current={!editor ? 'page' : undefined}
        >
          {copy.intro}
        </a>
        <a
          href={standalone ? './editor.html' : '/intro#editor'}
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
          onChange={(event) => changeTheme(event.target.value)}
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
      <details className="site-header-overflow">
        <summary aria-label={copy.navigation}>⋮</summary>
        <div>
          {editor && <button onClick={onOpenFile}>{copy.upload}</button>}
          <a href={workspaceUrl}>{initial ? copy.manageFiles : copy.login}</a>
          <a href={standalone ? './index.html' : '/intro'}>{copy.intro}</a>
          {!standalone && <a href="/intro#editor">{copy.local}</a>}
          <LanguageSelector />
          <select
            aria-label={copy.theme}
            value={theme}
            onChange={(event) => changeTheme(event.target.value)}
          >
            <option value="light">{copy.light}</option>
            <option value="dark">{copy.dark}</option>
            <option value="system">{copy.system}</option>
          </select>
        </div>
      </details>
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
