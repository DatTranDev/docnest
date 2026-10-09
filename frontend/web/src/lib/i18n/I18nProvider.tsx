'use client';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_TAGS,
  normalizeLocale,
  type Locale,
} from '@/config/locale';
import { MESSAGE, type MessageKey } from './messages';
import { translate, localize, translateError, countLabel, type MessageParams } from './translate';
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
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [locale, updateLocale] = useState(initialLocale);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = translate(locale, MESSAGE.writingRoom);
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', translate(locale, MESSAGE.privateDocumentsLightweightFormatting));
  }, [locale]);
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
