import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, normalizeLocale } from '@/config/locale';
import { I18nProvider } from '@/lib/i18n';
import { pageMetadata } from '@/lib/seo/server';
import './globals.css';
import './controls.css';
import './workspace.css';
import './preferences.css';
import './local-tools.css';
import './public-pages.css';
export async function generateMetadata(): Promise<Metadata> {
  return {
    ...(await pageMetadata('workspace')),
    referrer: 'no-referrer',
  };
}
export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = normalizeLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return (
    <html lang={locale}>
      <body>
        <I18nProvider initialLocale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
