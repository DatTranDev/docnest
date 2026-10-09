import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, normalizeLocale } from '@/config/locale';
import { I18nProvider } from '@/lib/i18n';
import { translate } from '@/lib/i18n/translate';
import { MESSAGE } from '@/lib/i18n/messages';
import './globals.css';
export async function generateMetadata(): Promise<Metadata> {
  const locale = normalizeLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return {
    title: translate(locale, MESSAGE.writingRoom),
    description: translate(locale, MESSAGE.privateDocumentsLightweightFormatting),
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
