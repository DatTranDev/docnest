import type { MetadataRoute } from 'next';
import { PUBLIC_PAGES } from '@/config/seo';
import { publicSiteUrl } from '@/lib/seo/server';
export const dynamic = 'force-dynamic';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = publicSiteUrl();
  return base ? Object.values(PUBLIC_PAGES).map((path) => ({ url: new URL(path, base).href })) : [];
}
