import { createRoot } from 'react-dom/client';
import { I18nProvider } from '@/lib/i18n';
import { LOCALE_COOKIE, normalizeLocale } from '@/config/locale';
import { SiteIntro } from '@/features/local-tools';
import LocalWorkbench from '@/features/local-tools/components/LocalWorkbench';
import '@/app/globals.css';
import '@/app/workspace.css';
import '@/app/preferences.css';
import '@/app/local-tools.css';
const stored = document.cookie
  .split('; ')
  .find((item) => item.startsWith(LOCALE_COOKIE + '='))
  ?.split('=')[1];
const locale = normalizeLocale(stored ?? 'vi');
createRoot(document.getElementById('root')!).render(
  <I18nProvider initialLocale={locale}>
    {location.pathname.endsWith('editor.html') ? (
      <LocalWorkbench standalone />
    ) : (
      <SiteIntro standalone />
    )}
  </I18nProvider>,
);
