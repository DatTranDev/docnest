import { createRoot, hydrateRoot } from 'react-dom/client';
import { lazy, Suspense } from 'react';
import { I18nProvider, MESSAGE } from '@/lib/i18n';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';
import { LOCALE_COOKIE, normalizeLocale } from '@/config/locale';
import { PublicPageContent } from './PublicPage';
import '@/app/globals.css';
import '@/app/controls.css';
import '@/app/workspace.css';
import '@/app/preferences.css';
import '@/app/local-tools.css';
import '@/app/public-pages.css';
const root = document.getElementById('root')!;
if (location.pathname.endsWith('editor.html')) {
  const LocalWorkbench = lazy(() => import('@/features/local-tools/components/LocalWorkbench'));
  const stored = document.cookie
    .split('; ')
    .find((item) => item.startsWith(LOCALE_COOKIE + '='))
    ?.split('=')[1];
  createRoot(root).render(
    <I18nProvider initialLocale={normalizeLocale(stored)} seoPage="local">
      <Suspense fallback={<LoadingIndicator message={MESSAGE.loading} />}>
        <LocalWorkbench standalone />
      </Suspense>
    </I18nProvider>,
  );
} else {
  const page = location.pathname.endsWith('privacy.html')
    ? 'privacy'
    : location.pathname.endsWith('terms.html')
      ? 'terms'
      : 'intro';
  hydrateRoot(root, <PublicPageContent page={page} />);
}
