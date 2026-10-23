'use client';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_TAGS,
  normalizeLocale,
  type Locale,
} from '@/config/locale';
import { type MessageKey } from './messages';
import { translate, localize, translateError, countLabel, type MessageParams } from './translate';
import { seoCopy } from './seo';
import { seoPageForPath, type SeoPage } from '@/config/seo';
interface I18n {
  locale: Locale;
  localeTag: string;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, params?: MessageParams) => string;
  localize: (value: string) => string;
  errorText: (value: string) => string;
  countLabel: (count: number, unit: Parameters<typeof countLabel>[2]) => string;
}
const Context = createContext<I18n | null>(null);
export function I18nProvider({
  initialLocale,
  children,
  seoPage,
}: {
  initialLocale: Locale;
  children: ReactNode;
  seoPage?: SeoPage;
}) {
  const [locale, updateLocale] = useState(initialLocale);
  useEffect(() => {
    document.documentElement.lang = locale;
    const page = seoPage ?? seoPageForPath(location.pathname);
    if (!page) return;
    const { title, description } = seoCopy(locale, page);
    document.title = title;
    for (const [selector, content] of [
      ['meta[name="description"]', description],
      ['meta[property="og:title"]', title],
      ['meta[property="og:description"]', description],
      ['meta[property="og:locale"]', locale === 'vi' ? 'vi_VN' : 'en_US'],
      ['meta[name="twitter:title"]', title],
      ['meta[name="twitter:description"]', description],
    ]) {
      if (selector && content) document.querySelector(selector)?.setAttribute('content', content);
    }
  }, [locale, seoPage]);
  const value = useMemo<I18n>(
    () => ({
      locale,
      localeTag: LOCALE_TAGS[locale],
      setLocale: (next) => {
        const normalized = normalizeLocale(next);
        document.cookie = `${LOCALE_COOKIE}=${normalized}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
        updateLocale(normalized);
      },
      t: (key, params) => translate(locale, key, params),
      localize: (value) => localize(locale, value),
      errorText: (value) => translateError(locale, value),
      countLabel: (count, unit) => countLabel(locale, count, unit),
    }),
    [locale],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useI18n(): I18n {
  const context = useContext(Context);
  if (!context) throw new Error('I18nProvider is required');
  return context;
}
