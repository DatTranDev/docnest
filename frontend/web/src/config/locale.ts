export const SUPPORTED_LOCALES = ['vi', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'vi';
export const LOCALE_COOKIE = 'ted-locale';
export const LOCALE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
export const LOCALE_TAGS: Record<Locale, string> = { vi: 'vi-VN', en: 'en-US' };
export function normalizeLocale(value: unknown): Locale {
  return value === 'en' || value === 'vi' ? value : DEFAULT_LOCALE;
}
