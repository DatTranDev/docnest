'use client';
import { normalizeLocale } from '@/config/locale';
import { useI18n, MESSAGE } from '@/lib/i18n';
export function LanguageSelector() {
  const { locale, setLocale, t } = useI18n();
  return (
    <select
      className="language-selector"
      aria-label={t(MESSAGE.language)}
      value={locale}
      onChange={(event) => setLocale(normalizeLocale(event.target.value))}
    >
      <option value="vi">{t(MESSAGE.vietnamese)}</option>
      <option value="en">{t(MESSAGE.english)}</option>
    </select>
  );
}
