export const PUBLIC_PAGES = {
  intro: '/intro',
  local: '/local',
  privacy: '/privacy',
  terms: '/terms',
} as const;
export type PublicPage = keyof typeof PUBLIC_PAGES;
export type SeoPage = PublicPage | 'workspace' | 'share' | 'internal';

export function seoPageForPath(pathname: string): SeoPage | undefined {
  if (pathname === '/') return 'workspace';
  if (pathname.startsWith('/s/')) return 'share';
  if (pathname === '/benchmark' || pathname === '/worker-contract') return 'internal';
  return (Object.keys(PUBLIC_PAGES) as PublicPage[]).find(
    (page) => PUBLIC_PAGES[page] === pathname,
  );
}

/** Use an explicit deployment URL; never infer a canonical host from request headers. */
export function siteBaseUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Site URL must be an HTTP(S) URL without credentials, query or fragment.');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}
