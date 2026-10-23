import { useEffect } from 'react';
import { I18nProvider, useI18n } from '@/lib/i18n';
import { LOCALE_COOKIE, normalizeLocale } from '@/config/locale';
import type { PublicPage } from '@/config/seo';
import { SiteIntro } from '@/features/local-tools/components/SiteIntro';
import { SitePolicy } from '@/features/local-tools/components/SitePolicy';

function RestoreLocale() {
  const { setLocale } = useI18n();
  useEffect(() => {
    const stored = document.cookie
      .split('; ')
      .find((item) => item.startsWith(LOCALE_COOKIE + '='))
      ?.split('=')[1];
    if (stored) setLocale(normalizeLocale(stored));
  }, [setLocale]);
  return null;
}

export function PublicPageContent({ page }: { page: Exclude<PublicPage, 'local'> }) {
  return (
    <I18nProvider initialLocale="vi" seoPage={page}>
      <RestoreLocale />
      {page === 'intro' ? <SiteIntro standalone /> : <SitePolicy kind={page} standalone />}
    </I18nProvider>
  );
}
