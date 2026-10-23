import type { MetadataRoute } from 'next';
import { publicSiteUrl } from '@/lib/seo/server';
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  const base = publicSiteUrl();
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/.well-known/', '/healthz'] },
    sitemap: base ? new URL('/sitemap.xml', base).href : undefined,
  };
}
