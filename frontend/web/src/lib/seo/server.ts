import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, normalizeLocale } from '@/config/locale';
import { PUBLIC_PAGES, siteBaseUrl, type SeoPage } from '@/config/seo';
import { seoCopy } from '@/lib/i18n/seo';

export function publicSiteUrl(): URL | undefined {
  const url = siteBaseUrl(process.env.SITE_URL);
  if (url && url.pathname !== '/') throw new Error('SITE_URL must be an origin without a path.');
  return url;
}

export async function pageMetadata(page: SeoPage): Promise<Metadata> {
  const locale = normalizeLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const { title, description } = seoCopy(locale, page);
  const isPublic = page in PUBLIC_PAGES;
  const base = isPublic ? publicSiteUrl() : undefined;
  const path = isPublic ? PUBLIC_PAGES[page as keyof typeof PUBLIC_PAGES] : undefined;
  const url = base && path ? new URL(path, base) : undefined;
  return {
    title,
    description,
    robots: isPublic ? { index: true, follow: true } : { index: false, follow: false },
    alternates: url ? { canonical: url } : undefined,
    openGraph: isPublic
      ? {
          type: 'website',
          siteName: 'Docnivo',
          title,
          description,
          locale: locale === 'vi' ? 'vi_VN' : 'en_US',
          url,
        }
      : undefined,
    twitter: isPublic ? { card: 'summary', title, description } : undefined,
  };
}
