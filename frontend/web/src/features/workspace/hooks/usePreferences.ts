'use client';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useI18n } from '@/lib/i18n';
import type { Locale } from '@/config/locale';

export type Theme = 'light' | 'dark' | 'system';
interface Preferences {
  locale?: Locale;
  theme: Theme;
}
const changed = 'docsnest-preferences-change';
const memory = new Map<string, string>();
export const preferenceKey = (userId: string) => `docsnest:preferences:${userId}`;
export function parsePreferences(raw: string | null): Preferences {
  try {
    const value = JSON.parse(raw ?? '{}');
    return {
      ...(value?.locale === 'vi' || value?.locale === 'en' ? { locale: value.locale } : {}),
      theme: value?.theme === 'light' || value?.theme === 'dark' ? value.theme : 'system',
    };
  } catch {
    return { theme: 'system' };
  }
}
function subscribe(listener: () => void) {
  window.addEventListener(changed, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(changed, listener);
    window.removeEventListener('storage', listener);
  };
}
function read(key: string) {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}
export function usePreferences(userId?: string) {
  const { locale, setLocale } = useI18n();
  const initialLocale = useRef(locale);
  const key = userId ? preferenceKey(userId) : '';
  const raw = useSyncExternalStore(
    subscribe,
    () => (key ? read(key) : null),
    () => null,
  );
  const preferences = useMemo(() => parsePreferences(raw), [raw]);
  useEffect(() => {
    if (!userId) initialLocale.current = locale;
  }, [userId, locale]);
  useEffect(() => {
    if (userId) setLocale(preferences.locale ?? initialLocale.current);
  }, [userId, preferences.locale, setLocale]);
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        preferences.theme === 'system' ? (query.matches ? 'dark' : 'light') : preferences.theme;
    };
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [preferences.theme]);
  const update = (patch: Partial<Preferences>) => {
    if (!key) return;
    const next = JSON.stringify({ ...parsePreferences(read(key)), ...patch });
    memory.set(key, next);
    try {
      localStorage.setItem(key, next);
    } catch {
      /* Session fallback retains account isolation. */
    }
    window.dispatchEvent(new Event(changed));
  };
  return { ...preferences, locale: preferences.locale ?? locale, update };
}
